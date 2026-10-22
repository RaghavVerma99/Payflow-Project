import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errors } from "../domain";
import {
  CreatePaymentBody,
  ListPaymentsQuery,
  ListRefundsQuery,
  PaymentDetailSchema,
  PaymentListSchema,
  PaymentParams,
  PaymentSchema,
  RefundListSchema,
} from "../schemas";
import {
  cancelPayment,
  createPayment,
  getPaymentDetail,
  listPayments,
} from "../services/payments";
import { listRefunds } from "../services/refunds";
import { serializePayment } from "../services/serializers";

export function idempotencyKeyFrom(
  headers: Record<string, unknown>,
): string | null {
  const raw = headers["idempotency-key"];
  if (raw === undefined) return null;
  if (typeof raw !== "string") {
    throw errors.invalid("Idempotency-Key must be a single value.");
  }
  const key = raw.trim();
  if (key.length < 1 || key.length > 255) {
    throw errors.invalid(
      "Idempotency-Key must be between 1 and 255 characters.",
      "invalid_idempotency_key",
    );
  }
  return key;
}

export function scenarioFrom(
  bodyScenario: string | undefined,
  headers: Record<string, unknown>,
  allowControls: boolean,
): string | undefined {
  const header = headers["x-simulator-scenario"];
  const scenario =
    bodyScenario ?? (typeof header === "string" ? header : undefined);

  if (scenario && scenario !== "auto" && !allowControls) {
    throw errors.simulatorDisabled();
  }
  return scenario;
}

export const paymentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/payments",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Payments"],
        summary: "Create a payment",
        description:
          "Creates a payment and enqueues it for asynchronous processing. Send an Idempotency-Key header to make retries safe.",
        body: CreatePaymentBody,
        response: { 202: PaymentSchema },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const scenario = scenarioFrom(
        body.simulator_scenario,
        request.headers,
        app.config.allowSimulatorControls,
      );

      const { payment, replayed } = createPayment(app.db, {
        merchantId: request.merchant.id,
        amountMinor: body.amount_minor,
        currency: body.currency,
        customerId: body.customer_id ?? null,
        description: body.description ?? null,
        paymentMethodId: body.payment_method_id ?? null,
        scenario,
        idempotencyKey: idempotencyKeyFrom(request.headers),
        idempotencyTtlHours: app.config.idempotencyTtlHours,
        maxJobAttempts: app.config.maxJobAttempts,
      });

      if (replayed) reply.header("Idempotency-Replayed", "true");
      reply.header("Location", `/v1/payments/${payment.id}`);
      return reply.code(202).send(serializePayment(payment));
    },
  );

  app.get(
    "/v1/payments",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Payments"],
        summary: "List payments",
        querystring: ListPaymentsQuery(
          app.config.defaultPageSize,
          app.config.maxPageSize,
        ),
        response: { 200: PaymentListSchema },
      },
    },
    async (request) => {
      return listPayments(app.db, {
        merchantId: request.merchant.id,
        limit: request.query.limit,
        cursor: request.query.cursor,
        status: request.query.status ?? null,
      });
    },
  );

  app.get(
    "/v1/payments/:id",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Payments"],
        summary: "Get a payment with attempts and events",
        params: PaymentParams,
        response: { 200: PaymentDetailSchema },
      },
    },
    async (request) => {
      return getPaymentDetail(app.db, request.merchant.id, request.params.id);
    },
  );

  app.post(
    "/v1/payments/:id/cancel",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Payments"],
        summary: "Cancel a payment that has not been processed",
        params: PaymentParams,
        response: { 200: PaymentSchema },
      },
    },
    async (request) => {
      const payment = cancelPayment(
        app.db,
        request.merchant.id,
        request.params.id,
      );
      return serializePayment(payment);
    },
  );

  app.get(
    "/v1/payments/:id/refunds",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Refunds"],
        summary: "List refunds for a payment",
        params: PaymentParams,
        querystring: ListRefundsQuery(
          app.config.defaultPageSize,
          app.config.maxPageSize,
        ),
        response: { 200: RefundListSchema },
      },
    },
    async (request) => {
      return listRefunds(app.db, {
        merchantId: request.merchant.id,
        paymentId: request.params.id,
        limit: request.query.limit,
        cursor: request.query.cursor ?? null,
        status: request.query.status ?? null,
      });
    },
  );
};
