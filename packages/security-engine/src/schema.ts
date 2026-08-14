import { z } from "zod";
import {
  AUTH_MUTATION_KINDS,
  MUTATION_LOCATIONS,
  MUTATION_OPERATIONS,
  SECURITY_FORMAT_VERSION,
  STATUS_CLASSES,
  TEST_CATEGORIES,
  TEST_SOURCES,
  type PersistedSecurityWorkspace,
  type SecurityWorkspace,
} from "./types.ts";
import { MAX_GENERATED_TESTS } from "./limits.ts";

/**
 * Persistence for generated negative tests (spec §40, §42).
 *
 * Same versioned `{version, ...}` envelope as every other persisted format in
 * this repo, validated with Zod on load and recovered from rather than
 * crashed on.
 *
 * ## The security-relevant part of this file
 *
 * What is stored is *test definitions*, never results. Spec §40 asks for an
 * audit of everything API Lab writes down, and the conclusion for this
 * milestone was that a security report is exactly the artifact people share
 * carelessly — so findings, responses, statuses, and durations live in memory
 * for the session and are gone on reload. Only definitions persist, and a
 * definition is credential-free by construction: `NegativeTest` holds a
 * request *id*, and `Mutation` can only name a fixed constant from
 * credentials.ts, never a resolved value (see types.ts).
 *
 * The Zod schema below is what enforces that at the boundary. `mutationValue`
 * accepts JSON, text, or one of six named auth kinds — so even a hand-edited
 * localStorage entry cannot smuggle a different mutation vocabulary into the
 * engine.
 *
 * The array is length-capped on load for the same reason contract-engine caps
 * its source text: localStorage is as untrusted as a file, and the limit that
 * bounds generation has to bound loading too, or the bound is decorative.
 */

const mutationValueSchema = z.union([
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("json"), json: z.unknown() }),
  z.object({ kind: z.literal("text"), text: z.string().max(8192) }),
  z.object({ kind: z.literal("auth"), auth: z.enum(AUTH_MUTATION_KINDS) }),
]);

export const mutationSchema = z.object({
  location: z.enum(MUTATION_LOCATIONS),
  operation: z.enum(MUTATION_OPERATIONS),
  target: z.string().max(1024),
  value: mutationValueSchema,
  description: z.string().max(512),
});

export const expectedBehaviorSchema = z.object({
  statusCodes: z.array(z.number().int().min(100).max(599)).max(20),
  statusClasses: z.array(z.enum(STATUS_CLASSES)).max(4),
  forbidServerError: z.boolean(),
  forbidInformationDisclosure: z.boolean(),
  forbidSensitiveData: z.boolean(),
  requiredSecurityHeaders: z.array(z.string().max(128)).max(20),
  checkCors: z.boolean(),
  checkTransport: z.boolean(),
});

export const negativeTestSchema = z.object({
  id: z.string(),
  name: z.string().max(512),
  category: z.enum(TEST_CATEGORIES),
  targetRequestId: z.string(),
  targetRequestName: z.string().max(512),
  mutation: mutationSchema,
  expected: expectedBehaviorSchema,
  enabled: z.boolean(),
  metadata: z.object({
    source: z.enum(TEST_SOURCES),
    ruleId: z.string().max(128),
    operationId: z.string().max(512).optional(),
    createdAt: z.string(),
  }),
});

export const securityWorkspaceSchema: z.ZodType<SecurityWorkspace> = z.object({
  tests: z.array(negativeTestSchema).max(MAX_GENERATED_TESTS),
}) as unknown as z.ZodType<SecurityWorkspace>;

export function serializeSecurity(security: SecurityWorkspace): PersistedSecurityWorkspace {
  return { version: SECURITY_FORMAT_VERSION, security };
}

export type DeserializeSecurityResult =
  | { ok: true; security: SecurityWorkspace }
  | { ok: false; reason: "invalid-envelope" | "unsupported-version" | "invalid-shape"; detail: string };

export function deserializeSecurity(raw: unknown): DeserializeSecurityResult {
  if (typeof raw !== "object" || raw === null || !("version" in raw) || !("security" in raw)) {
    return { ok: false, reason: "invalid-envelope", detail: "Missing version or security field." };
  }

  const { version, security } = raw as { version: unknown; security: unknown };

  if (typeof version !== "number") {
    return { ok: false, reason: "invalid-envelope", detail: "version must be a number." };
  }
  if (version !== SECURITY_FORMAT_VERSION) {
    return {
      ok: false,
      reason: "unsupported-version",
      detail: `Unsupported security format version: ${version}.`,
    };
  }

  const parsed = securityWorkspaceSchema.safeParse(security);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-shape", detail: parsed.error.message };
  }

  return { ok: true, security: parsed.data };
}

export function createEmptySecurityWorkspace(): SecurityWorkspace {
  return { tests: [] };
}
