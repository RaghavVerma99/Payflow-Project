import path from "node:path";

export type Environment = "dev" | "test" | "production";

export interface AppConfig {
  env: Environment;
  host: string;
  port: number;
  dbPath: string;
  apiKeyPepper: string;
  workerEnabled: boolean;
  workerPollMs: number;
  workerLeaseSeconds: number;
  maxJobAttempts: number;
  allowSimulatorControls: boolean;
  idempotencyTtlHours: number;
  defaultPageSize: number;
  maxPageSize: number;
  corsOrigin: string | string[] | boolean;
  rateLimitMax: number;
  logLevel: string;
}

const DEV_PEPPER = "dev-pepper-change-me";

export const repoRoot = path.resolve(import.meta.dirname, "../../..");

function resolveDbPath(value: string | undefined): string {
  if (!value) return path.join(repoRoot, "data", "payflow.db");
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean configuration value: ${value}`);
}

function int(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const rawEnv = overrides.env ?? process.env.PAYFLOW_ENV ??
    (process.env.NODE_ENV === "test" ? "test" : "dev");
  if (!["dev", "test", "production"].includes(rawEnv)) {
    throw new Error("PAYFLOW_ENV must be dev, test, or production.");
  }
  const env = rawEnv as Environment;

  const config: AppConfig = {
    env,
    host: process.env.PAYFLOW_HOST ?? "127.0.0.1",
    port: int("PAYFLOW_PORT", process.env.PAYFLOW_PORT, 4000, 1, 65535),
    dbPath: resolveDbPath(process.env.PAYFLOW_DB_PATH),
    apiKeyPepper: process.env.PAYFLOW_API_KEY_PEPPER ?? DEV_PEPPER,
    workerEnabled: bool(process.env.PAYFLOW_WORKER_ENABLED, env !== "test"),
    workerPollMs: int(
      "PAYFLOW_WORKER_POLL_MS",
      process.env.PAYFLOW_WORKER_POLL_MS,
      400,
      10,
      60_000,
    ),
    workerLeaseSeconds: int(
      "PAYFLOW_WORKER_LEASE_SECONDS",
      process.env.PAYFLOW_WORKER_LEASE_SECONDS,
      60,
      5,
      86_400,
    ),
    maxJobAttempts: int(
      "PAYFLOW_MAX_JOB_ATTEMPTS",
      process.env.PAYFLOW_MAX_JOB_ATTEMPTS,
      5,
      1,
      100,
    ),
    allowSimulatorControls: bool(
      process.env.PAYFLOW_ALLOW_SIMULATOR_CONTROLS,
      env !== "production",
    ),
    idempotencyTtlHours: int(
      "PAYFLOW_IDEMPOTENCY_TTL_HOURS",
      process.env.PAYFLOW_IDEMPOTENCY_TTL_HOURS,
      24,
      0,
      8760,
    ),
    defaultPageSize: int(
      "PAYFLOW_DEFAULT_PAGE_SIZE",
      process.env.PAYFLOW_DEFAULT_PAGE_SIZE,
      25,
      1,
      500,
    ),
    maxPageSize: int(
      "PAYFLOW_MAX_PAGE_SIZE",
      process.env.PAYFLOW_MAX_PAGE_SIZE,
      100,
      1,
      500,
    ),
    corsOrigin:
      env === "production"
        ? (process.env.PAYFLOW_CORS_ORIGIN ?? false)
        : (process.env.PAYFLOW_CORS_ORIGIN ?? true),
    rateLimitMax: int(
      "PAYFLOW_RATE_LIMIT_MAX",
      process.env.PAYFLOW_RATE_LIMIT_MAX,
      env === "test" ? 100_000 : 600,
      1,
      1_000_000,
    ),
    logLevel:
      process.env.PAYFLOW_LOG_LEVEL ?? (env === "test" ? "silent" : "info"),
    ...overrides,
  };

  const ranges: Array<[string, number, number, number]> = [
    ["PAYFLOW_PORT", config.port, 1, 65535],
    ["PAYFLOW_WORKER_POLL_MS", config.workerPollMs, 10, 60_000],
    ["PAYFLOW_WORKER_LEASE_SECONDS", config.workerLeaseSeconds, 5, 86_400],
    ["PAYFLOW_MAX_JOB_ATTEMPTS", config.maxJobAttempts, 1, 100],
    ["PAYFLOW_IDEMPOTENCY_TTL_HOURS", config.idempotencyTtlHours, 0, 8760],
    ["PAYFLOW_DEFAULT_PAGE_SIZE", config.defaultPageSize, 1, 500],
    ["PAYFLOW_MAX_PAGE_SIZE", config.maxPageSize, 1, 500],
    ["PAYFLOW_RATE_LIMIT_MAX", config.rateLimitMax, 1, 1_000_000],
  ];
  for (const [name, value, minimum, maximum] of ranges) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
    }
  }

  if (config.defaultPageSize > config.maxPageSize) {
    throw new Error(
      "PAYFLOW_DEFAULT_PAGE_SIZE cannot exceed PAYFLOW_MAX_PAGE_SIZE.",
    );
  }

  if (config.env === "production") {
    const origins = Array.isArray(config.corsOrigin)
      ? config.corsOrigin
      : [config.corsOrigin];
    if (origins.includes(true) || origins.includes("*")) {
      throw new Error("Production CORS must use an explicit origin.");
    }
    if (config.apiKeyPepper === DEV_PEPPER) {
      throw new Error("PAYFLOW_API_KEY_PEPPER must be set in production");
    }
    if (config.allowSimulatorControls) {
      throw new Error(
        "PAYFLOW_ALLOW_SIMULATOR_CONTROLS must be false in production",
      );
    }
  }

  return config;
}
