import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errors } from "../domain";
import { DemoSessionSchema, HealthSchema } from "../schemas";
import { loadDemoSession } from "../services/demo";
import { jobQueueDepth } from "../worker";
import { API_VERSION } from "../version";

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        operationId: "getHealth",
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
        version: API_VERSION,
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
        operationId: "getDemoSession",
        tags: ["System"],
        summary: "Demo workspace credentials",
        description:
          "Available when PAYFLOW_ENV=dev or PAYFLOW_DEMO_MODE=true and a demo key has been seeded.",
        security: [],
        response: { 200: DemoSessionSchema },
      },
    },
    async () => {
      if (app.config.env !== "dev" && !app.config.demoMode) {
        throw errors.notFound("Demo session");
      }

      const session = loadDemoSession(
        app.db,
        app.config.dbPath,
        app.config.apiKeyPepper,
      );

      return {
        api_key: session.apiKey,
        merchant: session.merchant,
        environment: app.config.env,
      };
    },
  );
};
