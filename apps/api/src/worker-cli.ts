import { loadConfig } from "./config";
import { createDb } from "./db";
import { newId } from "./domain";
import { startWorker } from "./worker";

const config = loadConfig({ workerEnabled: true, logLevel: "info" });
const handle = createDb(config.dbPath);

const worker = startWorker({
  db: handle.db,
  config,
  workerId: newId("wkr"),
  logger: console,
});

console.log(
  JSON.stringify(
    {
      service: "payflow-worker",
      database: config.dbPath,
      poll_ms: config.workerPollMs,
      lease_seconds: config.workerLeaseSeconds,
    },
    null,
    2,
  ),
);

let closing = false;
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  console.log(`payflow-worker stopping (${signal})`);
  worker.stop();
  handle.close();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
