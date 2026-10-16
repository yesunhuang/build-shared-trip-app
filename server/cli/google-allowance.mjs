// Offline owner/operator tool for the Google Places UI Kit monthly allowance ledger
// (<data dir>/google-allowance.sqlite; see server/google-allowance.mjs and
// references/google-places-ui-kit.md). It never contacts Google, never enables the feature, never
// prints the browser key or any other secret, and is not reachable from a browser or MCP.
//
//   status                                            read-only summary
//   init  --month YYYY-MM --baseline <n>              create the ledger once; refuses if one already exists
//   raise --month YYYY-MM --add <n>                   add n to this month's count (counts can never be lowered)
//   reconcile-clock --month YYYY-MM --baseline <n>    confirm a trustworthy clock and this month's usage so far;
//                                                     clears a recorded clock fault (never lowers a count)
//
// --month must name the current Pacific (America/Los_Angeles) billing month on this system clock,
// as an explicit confirmation that the clock and the month are right. --baseline is the owner's
// conservative number of UI Kit Query (Essentials) events this app may already have used this
// month (rounded up; 0 only when that is known). For reconcile-clock the ledger keeps the higher of
// its own count and --baseline. After init or reconcile-clock, restart the app so that it reopens
// the ledger. Run it as the same user as the app (UID 1000 in the Compose template) so that
// ownership and mode 0600 are preserved.
import fs from "node:fs";
import path from "node:path";
import { ALLOWANCE_LEDGER_FILE, initLedger, ledgerStatus, raiseLedger, readAllowanceConfig, reconcileClock } from "../google-allowance.mjs";

const USAGE = [
  "Usage (SHARED_TRIP_DATA_DIR=<existing data directory outside the checkout>):",
  "  node server/cli/google-allowance.mjs status",
  "  node server/cli/google-allowance.mjs init --month YYYY-MM --baseline <whole number>",
  "  node server/cli/google-allowance.mjs raise --month YYYY-MM --add <whole number>",
  "  node server/cli/google-allowance.mjs reconcile-clock --month YYYY-MM --baseline <whole number>"
].join("\n");

function dataDirectory() {
  const raw = process.env.SHARED_TRIP_DATA_DIR;
  if (!raw) throw new Error(USAGE);
  let directory;
  try { directory = fs.realpathSync(path.resolve(raw)); } catch { throw new Error("SHARED_TRIP_DATA_DIR must be an existing directory."); }
  if (!fs.statSync(directory).isDirectory()) throw new Error("SHARED_TRIP_DATA_DIR must be an existing directory.");
  const repo = fs.realpathSync(path.resolve(import.meta.dirname, "..", ".."));
  if (directory === repo || directory.startsWith(repo + path.sep)) throw new Error("The data directory must be outside the checkout.");
  return directory;
}

function options(args, allowed) {
  const out = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.includes(name) || value === undefined || Object.hasOwn(out, name)) throw new Error(USAGE);
    out[name] = value;
  }
  for (const name of allowed) if (!Object.hasOwn(out, name)) throw new Error(USAGE);
  return out;
}

function wholeNumber(value, name) {
  if (!/^(?:0|[1-9]\d{0,6})$/.test(value)) throw new Error(`${name} must be a whole number without signs, spaces or separators.`);
  return Number(value);
}

function print(status) {
  const lines = [
    `ledger: ${status.exists ? (status.valid ? "present and consistent" : "PRESENT BUT UNUSABLE") : "missing"}`,
    ...(status.problem ? [`problem: ${status.problem}`] : []),
    ...(status.notice ? [`notice: ${status.notice}`] : []),
    `current Pacific billing month: ${status.month || "unknown (clock or time-zone data unusable)"}`,
    ...(status.valid ? [
      `latest month recorded in the ledger: ${status.latestMonth}`,
      `newest recorded time: ${status.newestRecordedTime}`,
      `clock fault recorded: ${status.clockFault ? `${status.clockFault}${status.clockFaultAt ? ` (detected at ${status.clockFaultAt})` : ""}` : "none"}`,
      `reserved this month (including baseline and raises): ${status.used ?? "not recorded yet"}`
    ] : []),
    ...(status.limit !== undefined
      ? [`configured monthly allowance: ${status.allowance}`, `configured headroom: ${status.headroom}`, `maximum reservations per month: ${status.limit}`,
        ...(status.remaining !== undefined ? [`remaining this month: ${status.remaining}`] : [])]
      : [`allowance configuration in this environment: ${status.configuration}`])
  ];
  console.log(lines.join("\n"));
}

try {
  const [command, ...rest] = process.argv.slice(2);
  const file = path.join(dataDirectory(), ALLOWANCE_LEDGER_FILE);
  const config = readAllowanceConfig(process.env);
  if (command === "status" && rest.length === 0) {
    const status = ledgerStatus(file, { config });
    print(status);
    if (!status.valid || status.problem) process.exitCode = 2;
  } else if (command === "init") {
    const args = options(rest, ["--month", "--baseline"]);
    initLedger(file, { month: args["--month"], baseline: wholeNumber(args["--baseline"], "--baseline") });
    console.log("Google allowance ledger created. Restart the app so that it opens it. Google work still needs the feature flag, key, allowance, headroom and per-trip opt-in.");
    print(ledgerStatus(file, { config }));
  } else if (command === "raise") {
    const args = options(rest, ["--month", "--add"]);
    raiseLedger(file, { month: args["--month"], add: wholeNumber(args["--add"], "--add") });
    console.log("This month's count was raised.");
    print(ledgerStatus(file, { config }));
  } else if (command === "reconcile-clock") {
    const args = options(rest, ["--month", "--baseline"]);
    const result = reconcileClock(file, { month: args["--month"], baseline: wholeNumber(args["--baseline"], "--baseline") });
    console.log(`Clock and month confirmed${result.clearedFault ? `; the recorded clock fault (${result.clearedFault}) was cleared` : ""}. No count was lowered. Restart the app so that it reopens the ledger.`);
    print(ledgerStatus(file, { config }));
  } else {
    throw new Error(USAGE);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
