import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError, errors, nowIso } from "../domain";
import { ERROR_RESPONSES } from "../schemas";
import { loadDemoSession, resetDemoWorkspace } from "../services/demo";

const DemoResetSchema = z.object({
  object: z.literal("demo_reset"),
  merchant: z.object({ id: z.string(), name: z.string() }),
  payments: z.number().int(),
  refunds: z.number().int(),
  methods: z.number().int(),
  endpoints: z.number().int(),
  disputes: z.number().int(),
  payouts: z.number().int(),
  reset_at: z.string(),
});

function tokensMatch(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const demoRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/demo/reset",
    {
      schema: {
        operationId: "resetDemoWorkspace",
        tags: ["System"],
        summary: "Reset the demo workspace",
        description:
          "Deletes demo business data and reseeds it for the same merchant. Requires the x-demo-reset-token header. Only available when PAYFLOW_DEMO_MODE=true.",
        security: [],
        response: {
          200: DemoResetSchema,
          ...ERROR_RESPONSES,
        },
      },
    },
    async (request) => {
      const expected = app.config.demoResetToken;
      if (!app.config.demoMode || !expected) {
        throw errors.notFound("Demo reset");
      }

      const supplied = request.headers["x-demo-reset-token"];
      if (typeof supplied !== "string" || !tokensMatch(supplied, expected)) {
        throw new AppError(
          "demo_reset_unauthorized",
          401,
          "A valid x-demo-reset-token header is required.",
        );
      }

      const session = loadDemoSession(
        app.db,
        app.config.dbPath,
        app.config.apiKeyPepper,
      );
      const summary = resetDemoWorkspace(app.db, session.merchant.id, {
        maxJobAttempts: app.config.maxJobAttempts,
        port: app.config.port,
      });

      return {
        object: "demo_reset" as const,
        merchant: {
          id: session.merchant.id,
          name: session.merchant.name,
        },
        ...summary,
        reset_at: nowIso(),
      };
    },
  );
};
