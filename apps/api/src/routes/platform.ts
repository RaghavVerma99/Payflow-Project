import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  ApiKeyListSchema,
  ApiKeyParams,
  ApiKeySchema,
  CreateApiKeyBody,
  ReportQuery,
  SettlementQuery,
} from "../schemas";
import { ERROR_RESPONSES } from "../schemas";
import { createApiKey, listApiKeys, revokeApiKey } from "../services/api-keys";
import {
  listMerchantJobs,
  merchantJobSummary,
  retryDeadJob,
} from "../services/jobs";
import {
  normalizeWindow,
  paymentReport,
  paymentReportCsv,
  settlementReport,
} from "../services/reports";

const JobStatus = z.enum([
  "pending",
  "retrying",
  "running",
  "succeeded",
  "dead",
  "canceled",
]);
const JobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  aggregate_id: z.string().nullable(),
  status: JobStatus,
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  next_run_at: z.string(),
  last_error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const JobListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: JobStatus.optional(),
});
const JobParams = z.object({ id: z.string() });

export const platformRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/jobs",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "listJobs",
        tags: ["Operations"],
        summary: "Inspect the merchant job queue",
        querystring: JobListQuery,
        response: {
          200: z.object({
            data: z.array(JobSchema),
            summary: z.object({
              by_status: z.record(z.string(), z.number().int()),
              oldest_active_at: z.string().nullable(),
              oldest_active_age_seconds: z.number().int().nullable(),
            }),
          }),
          ...ERROR_RESPONSES,
        },
      },
    },
    async (request) => ({
      data: listMerchantJobs(
        app.db,
        request.merchant.id,
        request.query.limit,
        request.query.status,
      ),
      summary: merchantJobSummary(app.db, request.merchant.id),
    }),
  );

  app.post(
    "/v1/jobs/:id/retry",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "retryDeadJob",
        tags: ["Operations"],
        summary: "Retry a dead-letter job",
        description:
          "Requeues one of your dead-letter jobs. Successful webhook deliveries are skipped on replay.",
        params: JobParams,
        response: { 200: JobSchema, ...ERROR_RESPONSES },
      },
    },
    async (request) =>
      retryDeadJob(app.db, request.merchant.id, request.params.id),
  );

  app.post(
    "/v1/api_keys",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "createApiKey",
        tags: ["Merchants"],
        summary: "Create an API key",
        description:
          "The secret is returned once and never again. Only its hash is stored.",
        body: CreateApiKeyBody,
        response: { 201: ApiKeySchema.extend({ secret: z.string() }) },
      },
    },
    async (request, reply) => {
      const { key, secret } = createApiKey(
        app.db,
        request.merchant.id,
        app.config.apiKeyPepper,
        request.body.name ?? null,
      );

      return reply.code(201).send({ ...key, secret });
    },
  );

  app.get(
    "/v1/api_keys",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "listApiKeys",
        tags: ["Merchants"],
        summary: "List API keys",
        response: {
          200: ApiKeyListSchema,
          ...ERROR_RESPONSES,
        },
      },
    },
    async (request) => {
      return { data: listApiKeys(app.db, request.merchant.id) };
    },
  );

  app.post(
    "/v1/api_keys/:id/revoke",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "revokeApiKey",
        tags: ["Merchants"],
        summary: "Revoke an API key",
        description: "Revoked keys are rejected immediately.",
        params: ApiKeyParams,
        response: {
          200: ApiKeySchema,
          ...ERROR_RESPONSES,
        },
      },
    },
    async (request) => {
      return revokeApiKey(app.db, request.merchant.id, request.params.id);
    },
  );

  app.get(
    "/v1/reports/payments",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "getPaymentReport",
        tags: ["Analytics"],
        summary: "Payment report",
        description:
          "Aggregate and per-payment rows for a window. Add `format=csv` for a spreadsheet export.",
        querystring: ReportQuery.extend({
          format: z.enum(["json", "csv"]).default("json"),
        }),
      },
    },
    async (request, reply) => {
      const window = normalizeWindow(request.query.from, request.query.to);
      const report = paymentReport(
        app.db,
        request.merchant.id,
        window.from,
        window.to,
      );

      if (request.query.format === "csv") {
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header(
            "content-disposition",
            `attachment; filename="payments-${window.from.slice(0, 10)}-${window.to.slice(0, 10)}.csv"`,
          )
          .send(paymentReportCsv(report));
      }

      return report;
    },
  );

  app.get(
    "/v1/reports/settlement",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "getSettlementReport",
        tags: ["Analytics"],
        summary: "Settlement report for one day",
        querystring: SettlementQuery,
      },
    },
    async (request) => {
      return settlementReport(app.db, request.merchant.id, request.query.date);
    },
  );
};
