import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { HTTP_METHODS, type HttpMethod } from "@api-lab/shared";
import { MAX_OPERATIONS, MAX_SPEC_FILE_SIZE_BYTES } from "./limits.ts";
import { normalizeComponents, normalizeSchema } from "./schemaNormalize.ts";
import { SUPPORTED_PARAMETER_STYLES, type ContractMediaType, type ContractModel, type ContractOperation, type ContractParameter, type ContractResponse, type OpenApiVersion, type ParameterLocation, type ParameterStyle } from "./types.ts";

/**
 * Specification ingestion for contract testing.
 *
 * ## Relationship to Milestone 6's OpenAPI import
 *
 * Milestone 6 already parses OpenAPI documents, in
 * `@api-lab/collection-format`. That code was inspected before this was
 * written (spec §3) and left untouched — no defect was found, and spec §2 is
 * explicit that contract validation must not be coupled to the import UI.
 *
 * The two are deliberately different *projections* of the same documents,
 * not two ingestion mechanisms (spec §25):
 *
 * - M6's schema keeps what is needed to turn operations into runnable saved
 *   requests. It drops `responses`, `components.schemas`, and response
 *   `headers` entirely, because an importer has no use for them.
 * - Contract validation is almost entirely *about* those dropped fields.
 *
 * Widening M6's schema to cover both would have made every collection import
 * carry the cost of parsing response schemas it never reads, and would have
 * coupled the import format's evolution to the validator's. The shared parts
 * — the size limit, the JSON parse, the `openapi` version gate, the refusal
 * to throw on malformed input — follow the same rules in both places.
 */

// ---------------------------------------------------------------------------
// Document schema (structural validation of untrusted input)
// ---------------------------------------------------------------------------

const looseObject = z.record(z.unknown());

const parameterSchema = z.object({
  name: z.string(),
  in: z.string(),
  required: z.boolean().optional(),
  style: z.string().optional(),
  explode: z.boolean().optional(),
  schema: z.unknown().optional(),
});

const mediaTypeSchema = z.object({
  schema: z.unknown().optional(),
});

const headerSchema = z.object({
  required: z.boolean().optional(),
  schema: z.unknown().optional(),
});

const responseSchema = z.object({
  description: z.string().optional(),
  headers: z.record(headerSchema).optional(),
  content: z.record(mediaTypeSchema).optional(),
});

const requestBodySchema = z.object({
  required: z.boolean().optional(),
  content: z.record(mediaTypeSchema).optional(),
});

const operationSchema = z.object({
  operationId: z.string().optional(),
  summary: z.string().optional(),
  parameters: z.array(parameterSchema).optional(),
  requestBody: requestBodySchema.optional(),
  responses: z.record(responseSchema).optional(),
});

const securitySchemeSchema = z.object({
  type: z.string(),
  scheme: z.string().optional(),
  in: z.string().optional(),
  name: z.string().optional(),
});

export const contractDocumentSchema = z.object({
  openapi: z.string(),
  info: z.object({ title: z.string().optional() }).optional(),
  servers: z.array(z.object({ url: z.string() })).optional(),
  paths: z.record(looseObject).optional(),
  components: looseObject.optional(),
});

export type ContractParseResult =
  | { ok: true; contract: ContractModel }
  | { ok: false; reason: "too-large" | "invalid-syntax" | "unrecognized" | "unsupported-version"; detail: string };

// ---------------------------------------------------------------------------
// Source text → raw document
// ---------------------------------------------------------------------------

export type SpecSourceFormat = "json" | "yaml";

export function detectSourceFormat(text: string): SpecSourceFormat {
  return text.trimStart().startsWith("{") ? "json" : "yaml";
}

/**
 * Parses specification source text.
 *
 * ## YAML (spec §43)
 *
 * Milestone 6 deferred YAML. Contract testing is the milestone where that
 * stops being reasonable: OpenAPI documents are published as YAML far more
 * often than as JSON, and a contract validator that cannot read the team's
 * actual `openapi.yaml` is a validator nobody uses.
 *
 * The `yaml` package is used rather than `js-yaml` specifically because its
 * default `parse` is already the safe mode. There is no equivalent of
 * js-yaml's historical `load`-executes-custom-tags footgun: no constructor
 * tags, no code execution, no object instantiation from the document. It
 * also enforces its own alias-expansion budget, which bounds the "billion
 * laughs" entity-expansion attack that plain recursive YAML parsers are
 * vulnerable to. The same size limit is applied before parsing either
 * format, so a YAML document gets no weaker treatment than a JSON one.
 */
export function parseSpecSource(text: string): { ok: true; raw: unknown; format: SpecSourceFormat } | { ok: false; detail: string } {
  const format = detectSourceFormat(text);

  if (format === "json") {
    try {
      return { ok: true, raw: JSON.parse(text) as unknown, format };
    } catch {
      return { ok: false, detail: "The specification is not valid JSON." };
    }
  }

  try {
    // `prettyErrors` off keeps the message short enough for a dialog; the
    // alias budget is the library default and is not raised.
    const raw = parseYaml(text, { prettyErrors: false }) as unknown;
    if (raw === null || raw === undefined) {
      return { ok: false, detail: "The specification is empty." };
    }
    return { ok: true, raw, format };
  } catch (error) {
    return {
      ok: false,
      detail: `The specification is not valid YAML: ${error instanceof Error ? error.message : "parse failed"}.`,
    };
  }
}

// ---------------------------------------------------------------------------
// Raw document → contract model
// ---------------------------------------------------------------------------

const SUPPORTED_STYLE_SET = new Set<string>(SUPPORTED_PARAMETER_STYLES);
const PARAMETER_LOCATION_SET = new Set<string>(["path", "query", "header", "cookie"]);
const METHOD_SET = new Set<string>(HTTP_METHODS);

function detectVersion(openapi: string): OpenApiVersion | null {
  if (openapi.startsWith("3.0")) return "3.0";
  if (openapi.startsWith("3.1")) return "3.1";
  return null;
}

function adaptParameters(
  raw: z.infer<typeof parameterSchema>[],
  version: OpenApiVersion,
  warnings: string[],
): ContractParameter[] {
  const parameters: ContractParameter[] = [];

  for (const entry of raw) {
    if (!PARAMETER_LOCATION_SET.has(entry.in)) {
      warnings.push(`Parameter "${entry.name}" has unsupported location "${entry.in}" and is not validated.`);
      continue;
    }
    const location = entry.in as ParameterLocation;

    const normalized = normalizeSchema(entry.schema, version);
    warnings.push(...normalized.warnings);

    // Spec §21: implement the common styles and say plainly which are not
    // implemented, rather than claiming complete serialization support.
    let style: ParameterStyle | undefined;
    let unsupportedStyle: string | undefined;
    if (entry.style === undefined) {
      style = location === "query" || location === "cookie" ? "form" : "simple";
    } else if (SUPPORTED_STYLE_SET.has(entry.style)) {
      style = entry.style as ParameterStyle;
    } else {
      unsupportedStyle = entry.style;
    }

    parameters.push({
      name: entry.name,
      location,
      // OpenAPI requires path parameters to be required; a document that
      // omits the flag still means required.
      required: location === "path" ? true : (entry.required ?? false),
      schema: normalized.schema,
      style,
      explode: entry.explode,
      unsupportedStyle,
    });
  }

  return parameters;
}

function adaptContent(
  raw: Record<string, { schema?: unknown }> | undefined,
  version: OpenApiVersion,
  warnings: string[],
): ContractMediaType[] {
  if (!raw) return [];
  return Object.entries(raw).map(([contentType, media]) => {
    const normalized = normalizeSchema(media.schema, version);
    warnings.push(...normalized.warnings);
    return { contentType: contentType.trim().toLowerCase(), schema: normalized.schema };
  });
}

function adaptResponses(
  raw: Record<string, z.infer<typeof responseSchema>> | undefined,
  version: OpenApiVersion,
  warnings: string[],
): ContractResponse[] {
  if (!raw) return [];

  return Object.entries(raw).map(([statusKey, response]) => {
    const headers = Object.entries(response.headers ?? {}).map(([name, header]) => {
      const normalized = normalizeSchema(header.schema, version);
      warnings.push(...normalized.warnings);
      return { name, required: header.required ?? false, schema: normalized.schema };
    });

    return {
      statusKey: statusKey.trim(),
      headers,
      content: adaptContent(response.content, version, warnings),
    };
  });
}

/**
 * Builds the contract model. Never throws: a document that survives the
 * structural schema but contains nonsense in one operation degrades to a
 * warning about that operation, not a failed import.
 */
export function buildContractModel(raw: unknown): ContractParseResult {
  const parsed = contractDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "unrecognized",
      detail: `Not a recognizable OpenAPI document: ${parsed.error.issues[0]?.message ?? "invalid shape"}.`,
    };
  }

  const document = parsed.data;
  const version = detectVersion(document.openapi);
  if (version === null) {
    return {
      ok: false,
      reason: "unsupported-version",
      detail: `Unsupported OpenAPI version "${document.openapi}". API Lab's contract engine supports OpenAPI 3.0.x and 3.1.x.`,
    };
  }

  const warnings: string[] = [];
  const operations: ContractOperation[] = [];
  let truncated = false;

  for (const [path, pathItemRaw] of Object.entries(document.paths ?? {})) {
    if (typeof pathItemRaw !== "object" || pathItemRaw === null) continue;
    const pathItem = pathItemRaw as Record<string, unknown>;

    const pathLevelParsed = z.array(parameterSchema).safeParse(pathItem.parameters ?? []);
    const pathLevelParameters = pathLevelParsed.success
      ? adaptParameters(pathLevelParsed.data, version, warnings)
      : [];

    for (const [key, value] of Object.entries(pathItem)) {
      const method = key.toUpperCase();
      if (!METHOD_SET.has(method)) continue;
      if (operations.length >= MAX_OPERATIONS) {
        truncated = true;
        break;
      }

      const operationParsed = operationSchema.safeParse(value);
      if (!operationParsed.success) {
        warnings.push(`Operation "${method} ${path}" has an unrecognized shape and is not available for validation.`);
        continue;
      }
      const operation = operationParsed.data;

      const operationParameters = adaptParameters(operation.parameters ?? [], version, warnings);
      // Operation-level parameters override path-level ones with the same
      // name+location, per the OpenAPI specification.
      const merged = [...pathLevelParameters];
      for (const parameter of operationParameters) {
        const index = merged.findIndex((p) => p.name === parameter.name && p.location === parameter.location);
        if (index === -1) merged.push(parameter);
        else merged[index] = parameter;
      }

      operations.push({
        id: `${method} ${path}`,
        method: method as HttpMethod,
        path,
        operationId: operation.operationId,
        summary: operation.summary,
        parameters: merged,
        requestBody: operation.requestBody
          ? {
              required: operation.requestBody.required ?? false,
              content: adaptContent(operation.requestBody.content, version, warnings),
            }
          : undefined,
        responses: adaptResponses(operation.responses, version, warnings),
      });
    }
    if (truncated) break;
  }

  if (truncated) {
    warnings.push(
      `The specification declares more than ${MAX_OPERATIONS} operations; only the first ${MAX_OPERATIONS} are available for contract validation.`,
    );
  }

  const normalizedComponents = normalizeComponents(document.components, version);
  warnings.push(...normalizedComponents.warnings);

  const securitySchemes = Object.entries(
    (document.components?.securitySchemes as Record<string, unknown> | undefined) ?? {},
  ).flatMap(([name, value]) => {
    const scheme = securitySchemeSchema.safeParse(value);
    if (!scheme.success) return [];
    return [
      {
        name,
        type: scheme.data.type,
        scheme: scheme.data.scheme,
        location: scheme.data.in,
        parameterName: scheme.data.name,
      },
    ];
  });

  return {
    ok: true,
    contract: {
      title: document.info?.title ?? "Untitled API",
      version,
      openapiVersionString: document.openapi,
      servers: (document.servers ?? []).map((server) => server.url),
      operations,
      securitySchemes,
      components: normalizedComponents.components,
      // Duplicate warnings are common (one bad pattern reused across twenty
      // operations); the user needs the distinct set, not the tally.
      warnings: [...new Set(warnings)],
    },
  };
}

/**
 * The single entry point for turning specification file text into a contract
 * model. Mirrors `parseImportFile`'s contract in collection-format: typed
 * failures, never exceptions.
 */
export function parseContract(text: string): ContractParseResult {
  if (text.length > MAX_SPEC_FILE_SIZE_BYTES) {
    return {
      ok: false,
      reason: "too-large",
      detail: `The specification is larger than the ${(MAX_SPEC_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0)}MB limit.`,
    };
  }

  const source = parseSpecSource(text);
  if (!source.ok) return { ok: false, reason: "invalid-syntax", detail: source.detail };

  // Deeply nested documents can exhaust the call stack during the recursive
  // normalization walk — a RangeError, which Zod's safeParse does not catch.
  // Same defence as collection-format's importFile.ts.
  try {
    return buildContractModel(source.raw);
  } catch {
    return {
      ok: false,
      reason: "invalid-syntax",
      detail: "The specification could not be processed — it may be too deeply nested or structured in an unsupported way.",
    };
  }
}
