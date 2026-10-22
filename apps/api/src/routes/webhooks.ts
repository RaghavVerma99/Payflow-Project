import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { devSink } from "../schema";
import { nowIso } from "../domain";
import {
  CreateWebhookEndpointBody,
  EndpointParams,
  ListPaymentsQuery,
  ListWebhookEventQuery,
  WebhookDeliveryListSchema,
  WebhookEndpointListSchema,
  WebhookEndpointSchema,
  WebhookEventListSchema,
  WebhookEventSchema,
} from "../schemas";
import {
  createEndpoint,
  disableEndpoint,
  getEvent,
  listDeliveries,
  listEndpoints,
  listEvents,
} from "../services/webhooks";
import {
  serializeWebhookDelivery,
  serializeWebhookEndpoint,
  serializeWebhookEvent,
} from "../services/serializers";

const SinkBody = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  created_at: z.string().optional(),
  data: z.unknown().optional(),
});

export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/webhook_endpoints",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Webhooks"],
        summary: "Register a webhook endpoint",
        description:
          "Returns the signing secret once. Deliveries are signed with HMAC-SHA256 over `${timestamp}.${body}`.",
        body: CreateWebhookEndpointBody,
        response: {
          201: WebhookEndpointSchema.extend({ secret: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { endpoint, secret } = createEndpoint(app.db, {
        merchantId: request.merchant.id,
        url: request.body.url,
        description: request.body.description ?? null,
        allowPrivateHosts: app.config.env !== "production",
      });

      return reply
        .code(201)
        .send({ ...serializeWebhookEndpoint(endpoint), secret });
    },
  );

  app.get(
    "/v1/webhook_endpoints",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Webhooks"],
        summary: "List webhook endpoints",
        response: { 200: WebhookEndpointListSchema },
      },
    },
    async (request) => {
      return {
        data: listEndpoints(app.db, request.merchant.id).map(
          serializeWebhookEndpoint,
        ),
      };
    },
  );

  app.post(
    "/v1/webhook_endpoints/:id/disable",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Webhooks"],
        summary: "Disable a webhook endpoint",
        params: EndpointParams,
        response: { 200: WebhookEndpointSchema },
      },
    },
    async (request) => {
      return serializeWebhookEndpoint(
        disableEndpoint(app.db, request.merchant.id, request.params.id),
      );
    },
  );

  app.get(
    "/v1/webhook_events",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Webhooks"],
        summary: "List webhook events",
        querystring: ListWebhookEventQuery(
          app.config.defaultPageSize,
          app.config.maxPageSize,
        ),
        response: { 200: WebhookEventListSchema },
      },
    },
    async (request) => {
      const page = listEvents(
        app.db,
        request.merchant.id,
        request.query.limit,
        request.query.cursor ?? null,
        request.query.status ?? null,
      );
      return {
        data: page.data.map(serializeWebhookEvent),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
      };
    },
  );

  app.get(
    "/v1/webhook_events/:id",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Webhooks"],
        summary: "Get a webhook event",
        params: EndpointParams,
        response: { 200: WebhookEventSchema },
      },
    },
    async (request) => {
      return serializeWebhookEvent(
        getEvent(app.db, request.merchant.id, request.params.id),
      );
    },
  );

  app.get(
    "/v1/webhook_deliveries",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Webhooks"],
        summary: "List webhook delivery attempts",
        querystring: ListPaymentsQuery(
          app.config.defaultPageSize,
          app.config.maxPageSize,
        ),
        response: { 200: WebhookDeliveryListSchema },
      },
    },
    async (request) => {
      const page = listDeliveries(
        app.db,
        request.merchant.id,
        request.query.limit,
        request.query.cursor ?? null,
      );
      return {
        data: page.data.map(serializeWebhookDelivery),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
      };
    },
  );

  if (app.config.env === "dev") {
    app.post(
      "/_sink/:token",
      {
        schema: {
          tags: ["System"],
          summary: "Development webhook sink",
          description:
            "Receives webhook deliveries during development so the full loop can be inspected.",
          security: [],
          body: SinkBody,
        },
      },
      async (request, reply) => {
        const token = (request.params as { token: string }).token;
        const headers = request.headers as Record<string, string | undefined>;
        const body = request.body as z.infer<typeof SinkBody>;

        app.db
          .insert(devSink)
          .values({
            id: `sink_${randomBytes(8).toString("hex")}`,
            token,
            eventId: body.id ?? null,
            eventType: body.type ?? null,
            body: JSON.stringify(body),
            signature: headers["x-payflow-signature"] ?? null,
            receivedAt: nowIso(),
          })
          .run();

        return reply.code(200).send({ received: true });
      },
    );

    app.get(
      "/_sink/:token",
      {
        schema: {
          tags: ["System"],
          summary: "Inspect received development deliveries",
          security: [],
        },
      },
      async (request) => {
        const token = (request.params as { token: string }).token;
        const rows = app.db
          .select()
          .from(devSink)
          .where(eq(devSink.token, token))
          .orderBy(desc(devSink.receivedAt))
          .limit(50)
          .all();

        return {
          data: rows.map((row) => ({
            id: row.id,
            event_id: row.eventId,
            type: row.eventType,
            body: JSON.parse(row.body) as unknown,
            signature: row.signature,
            received_at: row.receivedAt,
          })),
        };
      },
    );
  }
};
