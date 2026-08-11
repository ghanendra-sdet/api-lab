import { detectFormat } from "./detect";
import { parsePostmanCollection, parsePostmanEnvironment } from "./postman/parse";
import { adaptPostmanCollection, adaptPostmanEnvironment } from "./postman/importAdapter";
import { parseOpenApiDocument } from "./openapi/parse";
import { adaptOpenApiDocument } from "./openapi/importAdapter";
import { parseNativeExport, adaptNativeExport } from "./native/import";
import { MAX_IMPORT_FILE_SIZE_BYTES, type ParseResult } from "./types";

/**
 * The single entry point the UI calls: raw file text in, a normalized
 * import (or a typed failure reason) out. The UI never needs to know which
 * parser/adapter ran — this is the parser-isolation boundary the milestone
 * spec requires, and the reason adding a future format (Insomnia, HAR,
 * curl) only means adding one more branch here.
 */
export function parseImportFile(fileText: string): ParseResult {
  if (fileText.length > MAX_IMPORT_FILE_SIZE_BYTES) {
    return {
      ok: false,
      reason: "too-large",
      detail: `File is larger than the ${(MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0)}MB import limit.`,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch {
    return { ok: false, reason: "invalid-json", detail: "The selected file is not valid JSON." };
  }

  const format = detectFormat(raw);

  // Parsing/adaptation involves recursive walks (Postman folder nesting,
  // zod's own recursive schema validation). A maliciously crafted,
  // pathologically deep — but still under the size limit — document could
  // exhaust the call stack. That throws a RangeError, not something zod's
  // safeParse catches; wrapping the whole dispatch converts it into an
  // ordinary failure result instead of an uncaught exception. See
  // docs/SECURITY.md's Milestone 6 section.
  try {
    switch (format) {
      case "api-lab-native": {
        const parsed = parseNativeExport(raw);
        if (!parsed.ok) return { ok: false, reason: "invalid-shape", detail: parsed.detail };
        return { ok: true, data: adaptNativeExport(parsed.data) };
      }
      case "postman-collection": {
        const parsed = parsePostmanCollection(raw);
        if (!parsed.ok) return { ok: false, reason: "invalid-shape", detail: parsed.detail };
        return { ok: true, data: adaptPostmanCollection(parsed.data) };
      }
      case "postman-environment": {
        const parsed = parsePostmanEnvironment(raw);
        if (!parsed.ok) return { ok: false, reason: "invalid-shape", detail: parsed.detail };
        return { ok: true, data: adaptPostmanEnvironment(parsed.data) };
      }
      case "openapi": {
        const parsed = parseOpenApiDocument(raw);
        if (!parsed.ok) return { ok: false, reason: "invalid-shape", detail: parsed.detail };
        return { ok: true, data: adaptOpenApiDocument(parsed.data) };
      }
      case "unknown":
      default:
        return {
          ok: false,
          reason: "unrecognized-format",
          detail: "The selected file does not contain a recognizable API collection, environment, or OpenAPI document.",
        };
    }
  } catch {
    return {
      ok: false,
      reason: "invalid-shape",
      detail: "The file could not be processed — it may be too deeply nested or structured in an unsupported way.",
    };
  }
}
