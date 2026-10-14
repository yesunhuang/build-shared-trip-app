// Viewer password hashing with Node's built-in scrypt.
//
// crypto.scrypt runs on the libuv thread pool, so request handlers await it without blocking the
// event loop. A small concurrency limit bounds memory use (each hash needs about 32 MiB) and turns
// floods into a generic 429 instead of an unbounded queue. Inputs are length-bounded before any
// hashing. Hashes are self-describing ("scrypt$N$r$p$salt$key") so parameters can be raised later.
import crypto from "node:crypto";
import { promisify } from "node:util";
import { DomainError } from "../domain/errors.mjs";

const scrypt = promisify(crypto.scrypt);
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const MAX_MEMORY = 64 * 1024 * 1024;
const MAX_CONCURRENT = 4;

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;
const MAX_PASSWORD_BYTES = 512;
const HASH_PATTERN = /^scrypt\$(\d{1,7})\$(\d{1,2})\$(\d{1,2})\$([A-Za-z0-9_-]{16,64})\$([A-Za-z0-9_-]{32,128})$/;

let active = 0;
async function withSlot(work) {
  if (active >= MAX_CONCURRENT) throw new DomainError("rate_limited", 429, "The server is busy. Try again shortly.");
  active++;
  try { return await work(); }
  finally { active--; }
}

/** Returns the canonical lowercase username, or "" when the input is not an acceptable username. */
export function normalizeUsername(value) {
  if (typeof value !== "string" || value.length > 64) return "";
  const name = value.trim().toLowerCase();
  return USERNAME_PATTERN.test(name) ? name : "";
}

/** Returns a public-safe problem description, or "" when the new password is acceptable. */
export function passwordProblem(value) {
  if (typeof value !== "string") return "A password is required.";
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH || Buffer.byteLength(value, "utf8") > MAX_PASSWORD_BYTES) {
    return "Passwords must contain " + MIN_PASSWORD_LENGTH + " to " + MAX_PASSWORD_LENGTH + " characters.";
  }
  return "";
}

/** Accepts only bounded strings for verification; anything else is treated as a failed attempt. */
export function boundedPassword(value) {
  return typeof value === "string" && value.length <= MAX_PASSWORD_LENGTH && Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES ? value : null;
}

function derive(secret, salt, cost, blockSize, parallelism, length) {
  return scrypt(Buffer.from(secret.normalize("NFKC"), "utf8"), salt, length, { N: cost, r: blockSize, p: parallelism, maxmem: MAX_MEMORY });
}

export async function hashPassword(secret) {
  if (passwordProblem(secret)) throw new DomainError("validation_failed", 422, "The password is not acceptable.");
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await withSlot(() => derive(secret, salt, COST, BLOCK_SIZE, PARALLELISM, KEY_LENGTH));
  return ["scrypt", COST, BLOCK_SIZE, PARALLELISM, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Constant-time comparison against a stored hash. Malformed or out-of-range stored hashes never match. */
export async function verifyPassword(secret, stored) {
  const parsed = HASH_PATTERN.exec(String(stored || ""));
  const candidate = boundedPassword(secret);
  if (!parsed || candidate === null) { await dummyVerify(); return false; }
  const [cost, blockSize, parallelism] = parsed.slice(1, 4).map(Number);
  const salt = Buffer.from(parsed[4], "base64url");
  const expected = Buffer.from(parsed[5], "base64url");
  if (cost < 1024 || cost > 1048576 || (cost & (cost - 1)) !== 0 || blockSize < 1 || blockSize > 16 || parallelism < 1 || parallelism > 4 ||
    128 * cost * blockSize > MAX_MEMORY || expected.length < 32) { await dummyVerify(); return false; }
  const actual = await withSlot(() => derive(candidate, salt, cost, blockSize, parallelism, expected.length));
  return crypto.timingSafeEqual(actual, expected);
}

// Unknown usernames still pay for one hash so response timing does not reveal which accounts exist.
let dummy;
export async function dummyVerify() {
  dummy ??= crypto.randomBytes(SALT_BYTES);
  await withSlot(() => derive("not-a-real-account-secret", dummy, COST, BLOCK_SIZE, PARALLELISM, KEY_LENGTH));
  return false;
}
