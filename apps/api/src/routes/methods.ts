import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  CreatePaymentMethodBody,
  ListMethodQuery,
  MethodParams,
  PaymentMethodListSchema,
  PaymentMethodSchema,
} from "../schemas";
import {
  createPaymentMethod,
  disablePaymentMethod,
  getPaymentMethod,
  listPaymentMethods,
} from "../services/payment-methods";
import { serializePaymentMethod } from "../services/serializers";

export const methodRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/payment_methods",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Payment methods"],
        summary: "Create a tokenized payment method",
        description:
          "Registers a simulated instrument. No card number is ever accepted; only display metadata such as the last four digits.",
        body: CreatePaymentMethodBody,
        response: { 201: PaymentMethodSchema },
      },
    },
    async (request, reply) => {
      const method = createPaymentMethod(app.db, {
        merchantId: request.merchant.id,
        type: request.body.type,
        label: request.body.label,
        last4: request.body.last4 ?? null,
        network: request.body.network ?? null,
        expiryMonth: request.body.expiry_month ?? null,
        expiryYear: request.body.expiry_year ?? null,
      });

      return reply.code(201).send(serializePaymentMethod(method));
    },
  );

  app.get(
    "/v1/payment_methods",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Payment methods"],
        summary: "List payment methods",
        querystring: ListMethodQuery(
          app.config.defaultPageSize,
          app.config.maxPageSize,
        ),
        response: { 200: PaymentMethodListSchema },
      },
    },
    async (request) => {
      const page = listPaymentMethods(
        app.db,
        request.merchant.id,
        request.query.limit,
        request.query.cursor ?? null,
        request.query.status ?? null,
      );

      return {
        data: page.data.map(serializePaymentMethod),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
      };
    },
  );

  app.get(
    "/v1/payment_methods/:id",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Payment methods"],
        summary: "Get a payment method",
        params: MethodParams,
        response: { 200: PaymentMethodSchema },
      },
    },
    async (request) => {
      return serializePaymentMethod(
        getPaymentMethod(app.db, request.merchant.id, request.params.id),
      );
    },
  );

  app.post(
    "/v1/payment_methods/:id/disable",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Payment methods"],
        summary: "Disable a payment method",
        description:
          "Disabled methods cannot be used for new payments. Existing payments keep their instrument.",
        params: MethodParams,
        response: { 200: PaymentMethodSchema },
      },
    },
    async (request) => {
      return serializePaymentMethod(
        disablePaymentMethod(app.db, request.merchant.id, request.params.id),
      );
    },
  );
};
