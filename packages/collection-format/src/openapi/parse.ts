import { openApiDocumentSchema, type OpenApiDocument } from "./schema";

export type OpenApiParseResult = { ok: true; data: OpenApiDocument } | { ok: false; detail: string };

const SUPPORTED_MAJOR_VERSIONS = ["3.0", "3.1"];

export function parseOpenApiDocument(raw: unknown): OpenApiParseResult {
  const parsed = openApiDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, detail: `Not a recognizable OpenAPI document: ${parsed.error.issues[0]?.message ?? "invalid shape"}.` };
  }
  const isSupported = SUPPORTED_MAJOR_VERSIONS.some((v) => parsed.data.openapi.startsWith(v));
  if (!isSupported) {
    return {
      ok: false,
      detail: `Unsupported OpenAPI version "${parsed.data.openapi}". API Lab supports OpenAPI 3.0.x and 3.1.x.`,
    };
  }
  return { ok: true, data: parsed.data };
}
