import { z } from "zod";
import {
  DOCUMENTATION_FORMAT_VERSION,
  DOC_FORMATS,
  DOC_GROUPING_MODES,
  DOC_SOURCE_KINDS,
  createDefaultSections,
  type DocumentationConfig,
  type DocumentationWorkspace,
  type PersistedDocumentationWorkspace,
} from "./types.ts";

/**
 * Persistence for documentation configurations (spec §42).
 *
 * Follows the same versioned `{version, ...}` envelope every persisted format
 * in this repository uses (workspace, environments, mock routes, performance
 * config, contracts, security tests): Zod-validated on load, never trusted,
 * recovered from rather than crashed on.
 *
 * ## What is stored, and what is emphatically not
 *
 * Stored: a *reference* to the source (a specification id, a collection id),
 * the chosen format, the section toggles, the grouping mode, and the example
 * settings. Nothing else.
 *
 * Not stored: generated HTML, generated Markdown, the documentation model,
 * or any rendered output. Spec §42 forbids treating rendered output as the
 * source of truth, and the reason is practical rather than doctrinal — a
 * cached documentation page goes stale against its own specification the
 * first time somebody edits the spec, and a stale page that *looks*
 * authoritative is worse than no page. Output is always regenerated from the
 * model, which is always regenerated from the source.
 *
 * A useful side effect: because only references are stored, this file cannot
 * leak a credential even in principle. There is no body, no header, no
 * example and no response here to redact.
 */

const sectionsSchema = z.object({
  overview: z.boolean(),
  authentication: z.boolean(),
  endpoints: z.boolean(),
  schemas: z.boolean(),
  examples: z.boolean(),
  contractStatus: z.boolean(),
});

/**
 * The `.transform` is not decoration.
 *
 * `DocumentationConfig` declares `specificationId: string | undefined` — the
 * key is always present and may hold undefined — while Zod's `.optional()`
 * produces `specificationId?: string`, where the key may be absent entirely.
 * TypeScript treats those as different types, and the repository's
 * `exactOptionalPropertyTypes`-adjacent strictness surfaces the difference
 * rather than papering over it.
 *
 * Normalizing here means every consumer downstream can read
 * `config.specificationId` without a presence check, and a config restored
 * from storage is indistinguishable from one just created.
 */
export const documentationConfigSchema: z.ZodType<DocumentationConfig, z.ZodTypeDef, unknown> = z
  .object({
    id: z.string(),
    name: z.string(),
    sourceKind: z.enum(DOC_SOURCE_KINDS),
    specificationId: z.string().optional(),
    collectionId: z.string().optional(),
    format: z.enum(DOC_FORMATS),
    sections: sectionsSchema,
    grouping: z.enum(DOC_GROUPING_MODES),
    includeCollectionExamples: z.boolean(),
    includeTimestamp: z.boolean(),
  })
  .transform((config) => ({
    ...config,
    specificationId: config.specificationId,
    collectionId: config.collectionId,
  }));

export const documentationWorkspaceSchema: z.ZodType<DocumentationWorkspace, z.ZodTypeDef, unknown> = z.object({
  configs: z.array(documentationConfigSchema),
});

export function createEmptyDocumentationWorkspace(): DocumentationWorkspace {
  return { configs: [] };
}

/** A configuration with the defaults the Documentation dialog opens on. */
export function createDefaultDocumentationConfig(id: string, name: string): DocumentationConfig {
  return {
    id,
    name,
    sourceKind: "openapi",
    specificationId: undefined,
    collectionId: undefined,
    format: "html",
    sections: createDefaultSections(),
    grouping: "auto",
    includeCollectionExamples: true,
    // Off by default so output is deterministic out of the box (spec §33).
    includeTimestamp: false,
  };
}

export function serializeDocumentation(
  documentation: DocumentationWorkspace,
): PersistedDocumentationWorkspace {
  return { version: DOCUMENTATION_FORMAT_VERSION, documentation };
}

export type DeserializeDocumentationResult =
  | { ok: true; documentation: DocumentationWorkspace }
  | { ok: false; reason: "invalid-envelope" | "unsupported-version" | "invalid-shape"; detail: string };

export function deserializeDocumentation(raw: unknown): DeserializeDocumentationResult {
  if (typeof raw !== "object" || raw === null || !("version" in raw) || !("documentation" in raw)) {
    return { ok: false, reason: "invalid-envelope", detail: "Missing version or documentation field." };
  }

  const { version, documentation } = raw as { version: unknown; documentation: unknown };

  if (typeof version !== "number") {
    return { ok: false, reason: "invalid-envelope", detail: "version must be a number." };
  }
  if (version !== DOCUMENTATION_FORMAT_VERSION) {
    return {
      ok: false,
      reason: "unsupported-version",
      detail: `Unsupported documentation format version: ${version}.`,
    };
  }

  const parsed = documentationWorkspaceSchema.safeParse(documentation);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-shape", detail: parsed.error.message };
  }

  return { ok: true, documentation: parsed.data };
}
