import { readConfig, startServer } from "./app.mjs";
try {
  const runtime = await startServer(readConfig());
  console.log("Shared Trips listening at " + runtime.url);
  let stopping = false;
  for (const signal of ["SIGINT","SIGTERM"]) process.on(signal,async () => {
    if (stopping) return; stopping = true;
    await runtime.close(); process.exit(0);
  });
} catch (error) { console.error(error.message); process.exitCode = 1; }
