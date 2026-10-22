import type Database from "better-sqlite3";
import type { AppConfig } from "./config";
import type { Db } from "./db";

export interface MerchantContext {
  id: string;
  name: string;
}

declare module "fastify" {
  interface FastifyRequest {
    merchant: MerchantContext;
  }

  interface FastifyInstance {
    db: Db;
    sqlite: Database.Database;
    config: AppConfig;
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}
