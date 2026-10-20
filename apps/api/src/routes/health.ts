import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AppError, errors } from "../domain";
import { repoRoot } from "../config";
import { DemoSessionSchema, HealthSchema } from "../schemas";
import { resolveApiKey } from "../services/auth";
import { jobQueueDepth } from "../worker";

const VERSION = "1.0.0";

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["System"],
        summary: "Liveness and readiness",
        security: [],
        response: { 200: HealthSchema },
      },
    },
    async () => {
      app.sqlite.prepare("select 1").get();
      return {
        status: "ok" as const,
        service: "payflow-api",
        version: VERSION,
        environment: app.config.env,
        checks: {
          database: "ok" as const,
          worker: app.config.workerEnabled
            ? ("enabled" as const)
            : ("disabled" as const),
        },
        queue_depth: jobQueueDepth(app.db),
      };
    },
  );

  app.get(
    "/v1/demo/session",
    {
      schema: {
        tags: ["System"],
        summary: "Development demo credentials",
        description:
          "Available only when PAYFLOW_ENV=dev and a demo key has been seeded.",
        security: [],
        response: { 200: DemoSessionSchema },
      },
    },
    async () => {
      if (app.config.env !== "dev") {
        throw errors.notFound("Demo session");
      }

      const keyFile = path.resolve(repoRoot, "data", "demo-key.json");
      if (!existsSync(keyFile)) {
        throw new AppError(
          "demo_not_seeded",
          404,
          "No demo workspace found. Run `npm run seed` first.",
        );
      }

      const parsed = JSON.parse(readFileSync(keyFile, "utf8")) as {
        api_key?: string;
      };
      if (!parsed.api_key) {
        throw new AppError(
          "demo_not_seeded",
          404,
          "Demo key file is invalid. Re-run `npm run seed`.",
        );
      }

      const merchant = resolveApiKey(
        app.db,
        parsed.api_key,
        app.config.apiKeyPepper,
      );
      if (!merchant) {
        throw new AppError(
          "demo_not_seeded",
          404,
          "The seeded demo key is no longer valid. Re-run `npm run seed`.",
        );
      }

      return {
        api_key: parsed.api_key,
        merchant,
        environment: app.config.env,
      };
    },
  );
};
