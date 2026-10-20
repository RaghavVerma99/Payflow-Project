import { createApp } from "./app";
import { newId } from "./domain";
import { startWorker } from "./worker";

const app = createApp();
const worker = app.config.workerEnabled
  ? startWorker({
      db: app.db,
      config: app.config,
      workerId: newId("wkr"),
      logger: app.log,
    })
  : null;

let closing = false;

async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "shutdown.start");
  worker?.stop();
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, "shutdown.error");
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: app.config.host, port: app.config.port });
  app.log.info(
    {
      port: app.config.port,
      environment: app.config.env,
      worker: Boolean(worker),
      docs: `http://localhost:${app.config.port}/docs`,
    },
    "payflow.ready",
  );
} catch (error) {
  app.log.error({ err: error }, "payflow.listen_failed");
  process.exit(1);
}
