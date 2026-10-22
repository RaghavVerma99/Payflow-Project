import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  CreateDisputeBody,
  CreatePayoutBody,
  DisputeListSchema,
  DisputeParams,
  DisputeSchema,
  ListDisputeQuery,
  ListPayoutQuery,
  PayoutListSchema,
  PayoutParams,
  PayoutSchema,
  ResolveDisputeBody,
} from "../schemas";
import { ERROR_RESPONSES } from "../schemas";
import { createPayout, getPayout, listPayouts } from "../services/payouts";
import {
  createDispute,
  getDispute,
  listDisputes,
  resolveDispute,
} from "../services/disputes";
import { serializeDispute, serializePayout } from "../services/serializers";
import { idempotencyKeyFrom, scenarioFrom } from "./payments";

export const treasuryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/payouts",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "createPayout",
        tags: ["Treasury"],
        summary: "Create a payout",
        description:
          "Moves money out of the merchant payable balance and into the merchant bank account. Rejected when the payable balance is insufficient.",
        body: CreatePayoutBody,
        response: {
          202: PayoutSchema,
          ...ERROR_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const scenario = scenarioFrom(
        body.simulator_scenario,
        request.headers,
        app.config.allowSimulatorControls,
      );

      const { payout, replayed } = createPayout(app.db, {
        merchantId: request.merchant.id,
        amountMinor: body.amount_minor,
        destination: body.destination,
        scenario,
        idempotencyKey: idempotencyKeyFrom(request.headers),
        idempotencyTtlHours: app.config.idempotencyTtlHours,
        maxJobAttempts: app.config.maxJobAttempts,
      });

      if (replayed) reply.header("Idempotency-Replayed", "true");
      reply.header("Location", `/v1/payouts/${payout.id}`);
      return reply.code(202).send(serializePayout(payout));
    },
  );

  app.get(
    "/v1/payouts",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "listPayouts",
        tags: ["Treasury"],
        summary: "List payouts",
        querystring: ListPayoutQuery(
          app.config.defaultPageSize,
          app.config.maxPageSize,
        ),
        response: {
          200: PayoutListSchema,
          ...ERROR_RESPONSES,
        },
      },
    },
    async (request) => {
      const page = listPayouts(app.db, {
        merchantId: request.merchant.id,
        limit: request.query.limit,
        cursor: request.query.cursor ?? null,
        status: request.query.status ?? null,
      });
      return {
        data: page.data.map(serializePayout),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
      };
    },
  );

  app.get(
    "/v1/payouts/:id",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "getPayout",
        tags: ["Treasury"],
        summary: "Get a payout",
        params: PayoutParams,
        response: {
          200: PayoutSchema,
          ...ERROR_RESPONSES,
        },
      },
    },
    async (request) => {
      return serializePayout(
        getPayout(app.db, request.merchant.id, request.params.id),
      );
    },
  );

  app.post(
    "/v1/disputes",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "createDispute",
        tags: ["Treasury"],
        summary: "Open a dispute against a settled payment",
        body: CreateDisputeBody,
        response: {
          201: DisputeSchema,
          ...ERROR_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const dispute = createDispute(app.db, {
        merchantId: request.merchant.id,
        paymentId: body.payment_id,
        amountMinor: body.amount_minor ?? null,
        reason: body.reason,
        note: body.note ?? null,
      });

      return reply.code(201).send(serializeDispute(dispute));
    },
  );

  app.get(
    "/v1/disputes",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "listDisputes",
        tags: ["Treasury"],
        summary: "List disputes",
        querystring: ListDisputeQuery(
          app.config.defaultPageSize,
          app.config.maxPageSize,
        ),
        response: {
          200: DisputeListSchema,
          ...ERROR_RESPONSES,
        },
      },
    },
    async (request) => {
      const page = listDisputes(app.db, {
        merchantId: request.merchant.id,
        limit: request.query.limit,
        cursor: request.query.cursor ?? null,
        status: request.query.status ?? null,
      });
      return {
        data: page.data.map(serializeDispute),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
      };
    },
  );

  app.get(
    "/v1/disputes/:id",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "getDispute",
        tags: ["Treasury"],
        summary: "Get a dispute",
        params: DisputeParams,
        response: {
          200: DisputeSchema,
          ...ERROR_RESPONSES,
        },
      },
    },
    async (request) => {
      return serializeDispute(
        getDispute(app.db, request.merchant.id, request.params.id),
      );
    },
  );

  app.post(
    "/v1/disputes/:id/resolve",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "resolveDispute",
        tags: ["Treasury"],
        summary: "Resolve a dispute",
        description:
          "A lost dispute debits the merchant payable and credits processor clearing. A won dispute posts nothing.",
        body: ResolveDisputeBody,
        params: DisputeParams,
        response: {
          200: DisputeSchema,
          ...ERROR_RESPONSES,
        },
      },
    },
    async (request) => {
      return serializeDispute(
        resolveDispute(
          app.db,
          request.merchant.id,
          request.params.id,
          request.body.outcome,
          request.body.note ?? null,
        ),
      );
    },
  );
};
