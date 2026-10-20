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

/** Repo root from both `src/` (tsx) and `dist/` (tsup bundle). */
export const repoRoot = path.resolve(import.meta.dirname, "../../..");

function resolveDbPath(value: string | undefined): string {
  if (!value) return path.join(repoRoot, "data", "payflow.db");
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = (overrides.env ??
    (process.env.PAYFLOW_ENV as Environment | undefined) ??
    (process.env.NODE_ENV === "test" ? "test" : "dev")) as Environment;

  const config: AppConfig = {
    env,
    host: process.env.PAYFLOW_HOST ?? "0.0.0.0",
    port: int(process.env.PAYFLOW_PORT, 4000),
    dbPath: resolveDbPath(process.env.PAYFLOW_DB_PATH),
    apiKeyPepper: process.env.PAYFLOW_API_KEY_PEPPER ?? DEV_PEPPER,
    workerEnabled: bool(process.env.PAYFLOW_WORKER_ENABLED, env !== "test"),
    workerPollMs: int(process.env.PAYFLOW_WORKER_POLL_MS, 400),
    workerLeaseSeconds: int(process.env.PAYFLOW_WORKER_LEASE_SECONDS, 60),
    maxJobAttempts: int(process.env.PAYFLOW_MAX_JOB_ATTEMPTS, 5),
    allowSimulatorControls: bool(process.env.PAYFLOW_ALLOW_SIMULATOR_CONTROLS, env !== "production"),
    idempotencyTtlHours: int(process.env.PAYFLOW_IDEMPOTENCY_TTL_HOURS, 24),
    defaultPageSize: int(process.env.PAYFLOW_DEFAULT_PAGE_SIZE, 25),
    maxPageSize: int(process.env.PAYFLOW_MAX_PAGE_SIZE, 100),
    corsOrigin:
      env === "production"
        ? (process.env.PAYFLOW_CORS_ORIGIN ?? false)
        : (process.env.PAYFLOW_CORS_ORIGIN ?? true),
    rateLimitMax: int(process.env.PAYFLOW_RATE_LIMIT_MAX, env === "test" ? 100_000 : 600),
    logLevel: process.env.PAYFLOW_LOG_LEVEL ?? (env === "test" ? "silent" : "info"),
    ...overrides,
  };

  if (config.env === "production") {
    if (config.apiKeyPepper === DEV_PEPPER) {
      throw new Error("PAYFLOW_API_KEY_PEPPER must be set in production");
    }
    if (config.allowSimulatorControls) {
      throw new Error("PAYFLOW_ALLOW_SIMULATOR_CONTROLS must be false in production");
    }
  }

  return config;
}
