import { z } from "zod";
import {
  MAX_DURATION_SECONDS,
  MAX_RAMP_UP_SECONDS,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_TARGET_RPS,
  MAX_THINK_TIME_MS,
  MAX_VIRTUAL_USERS,
  PERFORMANCE_CONFIG_FORMAT_VERSION,
  PERF_COMPARATORS,
  PERF_LOAD_MODELS,
  PERF_METRICS,
  PERF_TARGET_KINDS,
  type PersistedPerformanceConfig,
} from "./types.ts";

/**
 * Runtime validation for the one piece of performance state that is
 * persisted: the last-used configuration (spec §42). Execution state,
 * metrics, and reports are never persisted — see `docs/ARCHITECTURE.md`.
 *
 * Like every persisted format in this repo (workspace, environments, mock
 * routes), it is a versioned `{version, ...}` envelope validated with Zod on
 * load, and a corrupt file is recovered from rather than crashed on.
 */
export const perfThresholdSchema = z.object({
  id: z.string(),
  metric: z.enum(PERF_METRICS),
  comparator: z.enum(PERF_COMPARATORS),
  value: z.number().finite().min(0),
  enabled: z.boolean(),
});

export const performanceTestConfigSchema = z.object({
  targetKind: z.enum(PERF_TARGET_KINDS),
  targetId: z.string().nullable(),
  environmentId: z.string().nullable(),
  virtualUsers: z.number().int().min(1).max(MAX_VIRTUAL_USERS),
  durationSeconds: z.number().int().min(1).max(MAX_DURATION_SECONDS),
  rampUpSeconds: z.number().int().min(0).max(MAX_RAMP_UP_SECONDS),
  loadModel: z.enum(PERF_LOAD_MODELS),
  targetRps: z.number().int().min(1).max(MAX_TARGET_RPS),
  requestTimeoutMs: z.number().int().min(1).max(MAX_REQUEST_TIMEOUT_MS),
  thinkTimeMs: z.number().int().min(0).max(MAX_THINK_TIME_MS),
  thresholds: z.array(perfThresholdSchema).max(20),
});

export const persistedPerformanceConfigSchema: z.ZodType<PersistedPerformanceConfig> = z.object({
  version: z.literal(PERFORMANCE_CONFIG_FORMAT_VERSION),
  config: performanceTestConfigSchema,
});

/** The START payload accepted by the performance worker's HTTP API. The
 * worker validates independently of the browser — its port is reachable
 * without the UI, so it can never assume the caller already checked. */
export const perfRequestSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string()),
  body: z.string().nullable(),
  extractions: z.array(
    z.object({
      id: z.string(),
      source: z.enum(["json", "header"]),
      path: z.string(),
      variable: z.string(),
      enabled: z.boolean(),
    }),
  ),
});
