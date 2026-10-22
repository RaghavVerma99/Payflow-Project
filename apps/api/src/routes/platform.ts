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
import { createApiKey, listApiKeys, revokeApiKey } from "../services/api-keys";
import {
  normalizeWindow,
  paymentReport,
  paymentReportCsv,
  settlementReport,
} from "../services/reports";

export const platformRoutes: FastifyPluginAsyncZod = async (app) => {
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
        response: { 200: ApiKeyListSchema },
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
        response: { 200: ApiKeySchema },
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
