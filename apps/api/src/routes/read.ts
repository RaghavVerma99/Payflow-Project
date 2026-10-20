import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { decodeCursor } from "../domain";
import {
  AccountsResponseSchema,
  JournalListSchema,
  ListJournalsQuery,
  MerchantSchema,
  OverviewSchema,
  TimeseriesQuery,
  TimeseriesSchema,
} from "../schemas";
import {
  accountSummaries,
  listJournals,
  trialBalance,
} from "../services/ledger";
import { overview, timeseries } from "../services/stats";

export const readRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/merchants/me",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Merchants"],
        summary: "Current merchant",
        response: { 200: MerchantSchema },
      },
    },
    async (request) => {
      return {
        object: "merchant" as const,
        id: request.merchant.id,
        name: request.merchant.name,
        environment: app.config.env,
      };
    },
  );

  app.get(
    "/v1/accounts",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Ledger"],
        summary: "Accounts and trial balance",
        response: { 200: AccountsResponseSchema },
      },
    },
    async (request) => {
      return {
        data: accountSummaries(app.db, request.merchant.id),
        trial_balance: trialBalance(app.db, request.merchant.id),
      };
    },
  );

  app.get(
    "/v1/ledger/journals",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Ledger"],
        summary: "List posted journals",
        querystring: ListJournalsQuery,
        response: { 200: JournalListSchema },
      },
    },
    async (request) => {
      const before = request.query.cursor
        ? decodeCursor(request.query.cursor)
        : undefined;
      return listJournals(app.db, request.merchant.id, {
        limit: request.query.limit,
        before,
      });
    },
  );

  app.get(
    "/v1/stats/overview",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Analytics"],
        summary: "Dashboard overview",
        response: { 200: OverviewSchema },
      },
    },
    async (request) => {
      return overview(app.db, request.merchant);
    },
  );

  app.get(
    "/v1/stats/timeseries",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Analytics"],
        summary: "Daily payment volume",
        querystring: TimeseriesQuery,
        response: { 200: TimeseriesSchema },
      },
    },
    async (request) => {
      return {
        days: request.query.days,
        data: timeseries(app.db, request.merchant.id, request.query.days),
      };
    },
  );
};
