import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig, type AppConfig } from "./config";
import { createDb } from "./db";
import { AppError, errors, newId } from "./domain";
import type { MerchantContext } from "./types";
import { healthRoutes } from "./routes/health";
import { paymentRoutes } from "./routes/payments";
import { readRoutes } from "./routes/read";
import { refundRoutes } from "./routes/refunds";
import { resolveApiKey } from "./services/auth";
import "./types";

export interface CreateAppOptions {
  config?: Partial<AppConfig>;
  dbPath?: string;
  serveStatic?: boolean;
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = loadConfig(options.config);
  const handle = createDb(options.dbPath ?? config.dbPath);

  const app = Fastify({
    logger:
      config.logLevel === "silent"
        ? false
        : { level: config.logLevel, name: "payflow" },
    genReqId: (request) =>
      (request.headers["x-request-id"] as string | undefined) ?? newId("req"),
    requestIdHeader: "x-request-id",
    logController: new LogController({
      requestIdLogLabel: "request_id",
      disableRequestLogging: config.env === "test",
    }),
    trustProxy: config.env === "production",
    bodyLimit: 1024 * 1024,
  });

  app.decorate("db", handle.db);
  app.decorate("sqlite", handle.sqlite);
  app.decorate("config", config);
  app.decorateRequest("merchant", null as unknown as MerchantContext);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate(
    "authenticate",
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const header = request.headers.authorization;
      if (!header || !header.startsWith("Bearer ")) {
        throw errors.unauthorized();
      }
      const raw = header.slice("Bearer ".length).trim();
      const merchant = resolveApiKey(handle.db, raw, config.apiKeyPepper);
      if (!merchant) throw errors.unauthorized();
      request.merchant = merchant;
    },
  );

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const fastifyError = error as {
      statusCode?: number;
      code?: string;
      message: string;
    };

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: {
          code: "validation_error",
          message: "Request validation failed.",
          details: error.validation,
          request_id: request.id,
        },
      });
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, "response.serialization_failed");
      return reply.code(500).send({
        error: {
          code: "response_serialization_error",
          message: "The response did not match its schema.",
          request_id: request.id,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          request_id: request.id,
        },
      });
    }

    const status = fastifyError.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, "request.failed");
    }

    return reply.code(status).send({
      error: {
        code:
          status >= 500
            ? "internal_error"
            : (fastifyError.code ?? "request_error"),
        message:
          status >= 500
            ? "An unexpected error occurred."
            : fastifyError.message,
        request_id: request.id,
      },
    });
  });

  void app.register(cors, { origin: config.corsOrigin });
  void app.register(helmet, { contentSecurityPolicy: false });
  void app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: "1 minute",
    allowList: [],
  });
  void app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "PayFlow API",
        version: "1.0.0",
        description: [
          "Payment processing simulator: idempotent payment creation, an explicit",
          "state machine, asynchronous processing with retries, double-entry",
          "accounting and refunds.",
          "",
          "**No real card data is accepted and no real money moves.**",
        ].join("\n"),
      },
      servers: [{ url: "/", description: "Current host" }],
      tags: [
        { name: "Payments", description: "Create and inspect payments" },
        { name: "Refunds", description: "Refund succeeded payments" },
        { name: "Ledger", description: "Double-entry accounts and journals" },
        { name: "Analytics", description: "Dashboard aggregates" },
        { name: "Merchants", description: "Authenticated merchant context" },
        { name: "System", description: "Health and developer utilities" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "Merchant API key, for example `sk_test_...`",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  void app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      persistAuthorization: true,
    },
    staticCSP: false,
  });

  void app.register(healthRoutes);
  void app.register(paymentRoutes);
  void app.register(refundRoutes);
  void app.register(readRoutes);

  const serveStatic = options.serveStatic ?? config.env !== "test";

  const webDist = path.resolve(import.meta.dirname, "../../web/dist");
  const hasWebBuild = serveStatic && existsSync(webDist);

  if (hasWebBuild) {
    void app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      wildcard: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? "";
    const isApi =
      url.startsWith("/v1") ||
      url.startsWith("/health") ||
      url.startsWith("/docs") ||
      url.startsWith("/openapi");

    if (!isApi && hasWebBuild) {
      return reply.sendFile("index.html");
    }

    return reply.code(404).send({
      error: {
        code: "not_found",
        message: `Route ${request.method} ${url} not found.`,
        request_id: request.id,
      },
    });
  });

  app.addHook("onClose", async () => {
    handle.close();
  });

  return app;
}
