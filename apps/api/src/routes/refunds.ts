import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  CreateRefundBody,
  ListRefundsQuery,
  RefundListSchema,
  RefundParams,
  RefundSchema,
} from "../schemas";
import { createRefund, getRefund, listRefunds } from "../services/refunds";
import { serializeRefund } from "../services/serializers";
import { idempotencyKeyFrom, scenarioFrom } from "./payments";

export const refundRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/refunds",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Refunds"],
        summary: "Refund a succeeded payment",
        description:
          "Reserves refundable capacity atomically, then enqueues processor work. Supports partial refunds and Idempotency-Key.",
        body: CreateRefundBody,
        response: { 202: RefundSchema },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const scenario = scenarioFrom(
        body.simulator_scenario,
        request.headers,
        app.config.allowSimulatorControls,
      );

      const { refund, replayed } = createRefund(app.db, {
        merchantId: request.merchant.id,
        paymentId: body.payment_id,
        amountMinor: body.amount_minor ?? null,
        reason: body.reason ?? null,
        scenario,
        idempotencyKey: idempotencyKeyFrom(request.headers),
        idempotencyTtlHours: app.config.idempotencyTtlHours,
      });

      if (replayed) reply.header("Idempotency-Replayed", "true");
      reply.header("Location", `/v1/refunds/${refund.id}`);
      return reply.code(202).send(serializeRefund(refund));
    },
  );

  app.get(
    "/v1/refunds",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Refunds"],
        summary: "List refunds",
        querystring: ListRefundsQuery,
        response: { 200: RefundListSchema },
      },
    },
    async (request) => {
      return listRefunds(app.db, {
        merchantId: request.merchant.id,
        limit: request.query.limit,
        cursor: request.query.cursor,
        paymentId: request.query.payment_id ?? null,
        status: request.query.status ?? null,
      });
    },
  );

  app.get(
    "/v1/refunds/:id",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Refunds"],
        summary: "Get a refund",
        params: RefundParams,
        response: { 200: RefundSchema },
      },
    },
    async (request) => {
      return serializeRefund(
        getRefund(app.db, request.merchant.id, request.params.id),
      );
    },
  );
};
