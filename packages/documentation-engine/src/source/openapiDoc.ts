import { z } from "zod";
import { HTTP_METHODS } from "@api-lab/shared";
import { capText } from "../redact.ts";

/**
 * The *documentation projection* of an OpenAPI document (spec §6).
 *
 * ## Why this is not a second parser
 *
 * Spec §6 says: do not create another independent OpenAPI parser if existing
 * normalized models can safely be reused. This file is the answer to that
 * constraint, and it is worth being precise about what it does and does not
 * do, because the distinction is the whole architectural decision of M13.
 *
 * `contract-engine/src/parse.ts` already documents the pattern. Milestone 6's
 * importer and Milestone 11's validator are two different *projections* of
 * the same document, not two ingestion mechanisms — the importer keeps what
 * turns operations into runnable requests, the validator keeps what
 * validation needs, and neither carries the other's cost. Milestone 13 is the
 * third projection, built on the same principle.
 *
 * Concretely, this file does **no ingestion at all**:
 *
 * - It does not read files, and it does not know about size limits.
 * - It does not parse YAML or JSON. `parseSpecSource` in contract-engine does
 *   that — one safe YAML configuration, one alias budget, one place to audit.
 * - It does not interpret schemas. `buildContractModel` normalizes those
 *   (3.0 `nullable` → 3.1 type arrays) with its ReDoS screening intact, and
 *   documentation describes the *already normalized* result.
 * - It does not decide which operations exist. The contract model is
 *   authoritative for that (spec §5).
 *
 * What it does is read the fields the contract model deliberately discards:
 * `info.description`, `info.version`, server descriptions, `tags`, per-
 * operation `description`/`tags`/`deprecated`, response descriptions, request
 * body descriptions, parameter descriptions and examples, declared `example`
 * / `examples`, and security scheme descriptions.
 *
 * The alternative — widening `ContractModel` to carry prose — was rejected
 * for the reason its own header comment gives: it would double the memory
 * cost of every attached specification for data the validator never reads,
 * and it would mean reopening a completed milestone with no defect to fix.
 *
 * ## Everything here is untrusted
 *
 * Every field is `.optional()` and every consumer tolerates absence. A
 * document that satisfies `contractDocumentSchema` but has nonsense in its
 * prose fields degrades to missing descriptions, never to a failed
 * generation — the same never-throw contract the rest of the pipeline holds.
 */

// ---------------------------------------------------------------------------
// Structural schema for the prose layer
// ---------------------------------------------------------------------------

const exampleSchema = z.object({
  summary: z.string().optional(),
  description: z.string().optional(),
  value: z.unknown().optional(),
});

const mediaTypeDocSchema = z.object({
  example: z.unknown().optional(),
  examples: z.record(exampleSchema).optional(),
});

const parameterDocSchema = z.object({
  name: z.string(),
  in: z.string(),
  description: z.string().optional(),
  example: z.unknown().optional(),
  examples: z.record(exampleSchema).optional(),
  schema: z.unknown().optional(),
});

const responseDocSchema = z.object({
  description: z.string().optional(),
  headers: z.record(z.object({ description: z.string().optional() })).optional(),
  content: z.record(mediaTypeDocSchema).optional(),
});

const operationDocSchema = z.object({
  summary: z.string().optional(),
  description: z.string().optional(),
  operationId: z.string().optional(),
  deprecated: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  parameters: z.array(parameterDocSchema).optional(),
  requestBody: z
    .object({
      description: z.string().optional(),
      content: z.record(mediaTypeDocSchema).optional(),
    })
    .optional(),
  responses: z.record(responseDocSchema).optional(),
  security: z.array(z.record(z.array(z.string()))).optional(),
});

const documentDocSchema = z.object({
  info: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
  servers: z.array(z.object({ url: z.string(), description: z.string().optional() })).optional(),
  tags: z.array(z.object({ name: z.string(), description: z.string().optional() })).optional(),
  paths: z.record(z.record(z.unknown())).optional(),
  security: z.array(z.record(z.array(z.string()))).optional(),
  components: z
    .object({
      securitySchemes: z
        .record(
          z.object({
            type: z.string().optional(),
            description: z.string().optional(),
            scheme: z.string().optional(),
            bearerFormat: z.string().optional(),
            in: z.string().optional(),
            name: z.string().optional(),
            flows: z.record(z.unknown()).optional(),
            openIdConnectUrl: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Extracted shapes
// ---------------------------------------------------------------------------

export interface OpenApiExample {
  /** Stringified example value, not yet redacted. */
  value: string;
  summary: string | undefined;
  contentType: string | undefined;
}

export interface OpenApiParameterDoc {
  description: string | undefined;
  example: string | undefined;
  defaultValue: string | undefined;
}

export interface OpenApiOperationDoc {
  summary: string | undefined;
  description: string | undefined;
  deprecated: boolean;
  tags: string[];
  /** Keyed by `${location}:${name}`. */
  parameters: Record<string, OpenApiParameterDoc>;
  requestBodyDescription: string | undefined;
  requestExamples: OpenApiExample[];
  /** Keyed by status key, e.g. "200". */
  responseDescriptions: Record<string, string>;
  /** Keyed by `${status}:${headerName}`. */
  responseHeaderDescriptions: Record<string, string>;
  /** Keyed by status key. */
  responseExamples: Record<string, OpenApiExample[]>;
  /** Security scheme names required by this operation, if it declares any. */
  securitySchemeNames: string[] | undefined;
}

export interface OpenApiSecuritySchemeDoc {
  description: string | undefined;
  bearerFormat: string | undefined;
  /** OAuth2 flow names present, e.g. ["authorizationCode"]. Metadata only. */
  flowNames: string[];
  openIdConnectUrl: string | undefined;
}

export interface OpenApiDocMetadata {
  title: string | undefined;
  description: string | undefined;
  version: string | undefined;
  /** Keyed by server URL. */
  serverDescriptions: Record<string, string>;
  /** Declared tags in document order, which is the intended reading order. */
  tags: Array<{ name: string; description: string | undefined }>;
  /** Keyed by `${METHOD} ${path}` — the same key ContractOperation.id uses. */
  operations: Record<string, OpenApiOperationDoc>;
  /** Keyed by scheme name. */
  securitySchemes: Record<string, OpenApiSecuritySchemeDoc>;
  /** Document-level security requirement scheme names. */
  globalSecuritySchemeNames: string[];
}

export function createEmptyOpenApiDocMetadata(): OpenApiDocMetadata {
  return {
    title: undefined,
    description: undefined,
    version: undefined,
    serverDescriptions: {},
    tags: [],
    operations: {},
    securitySchemes: {},
    globalSecuritySchemeNames: [],
  };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const METHOD_SET = new Set<string>(HTTP_METHODS);

/**
 * Stringifies an example value from a document.
 *
 * Objects are pretty-printed as JSON, which is what a reader of an HTTP API
 * expects to see. Strings are passed through rather than being JSON-quoted:
 * a `text/plain` example of `hello` should document as `hello`, not `"hello"`.
 */
function stringifyExample(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Circular structures cannot occur in parsed JSON/YAML, but a document
    // is untrusted input and this costs one try/catch.
    return undefined;
  }
}

function extractMediaExamples(
  content: Record<string, z.infer<typeof mediaTypeDocSchema>> | undefined,
): OpenApiExample[] {
  if (content === undefined) return [];

  const examples: OpenApiExample[] = [];
  // Sorted by content type for determinism (spec §33).
  for (const contentType of Object.keys(content).sort((a, b) => a.localeCompare(b))) {
    const media = content[contentType];
    if (media === undefined) continue;

    const single = stringifyExample(media.example);
    if (single !== undefined) {
      examples.push({ value: single, summary: undefined, contentType });
    }

    for (const name of Object.keys(media.examples ?? {}).sort((a, b) => a.localeCompare(b))) {
      const entry = media.examples?.[name];
      if (entry === undefined) continue;
      const value = stringifyExample(entry.value);
      if (value === undefined) continue;
      examples.push({
        value,
        summary: capText(entry.summary ?? entry.description) ?? name,
        contentType,
      });
    }
  }

  return examples;
}

/** Flattens a `security` requirement array into the scheme names it names. */
function securitySchemeNames(
  requirements: Array<Record<string, string[]>> | undefined,
): string[] | undefined {
  if (requirements === undefined) return undefined;
  const names = new Set<string>();
  for (const requirement of requirements) {
    for (const name of Object.keys(requirement)) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Extracts the documentation projection from an already-parsed OpenAPI
 * document.
 *
 * Takes `unknown` — the value `parseSpecSource` returned — and never throws.
 * A document that fails the structural schema yields empty metadata, so
 * generation continues with contract-derived structure and no prose, which is
 * degraded but honest.
 */
export function extractOpenApiDocMetadata(raw: unknown): OpenApiDocMetadata {
  const parsed = documentDocSchema.safeParse(raw);
  if (!parsed.success) return createEmptyOpenApiDocMetadata();

  const document = parsed.data;
  const metadata = createEmptyOpenApiDocMetadata();

  metadata.title = capText(document.info?.title);
  metadata.description = capText(document.info?.description);
  metadata.version = capText(document.info?.version);

  for (const server of document.servers ?? []) {
    const description = capText(server.description);
    if (description !== undefined) metadata.serverDescriptions[server.url] = description;
  }

  metadata.tags = (document.tags ?? []).map((tag) => ({
    name: tag.name,
    description: capText(tag.description),
  }));

  metadata.globalSecuritySchemeNames = securitySchemeNames(document.security) ?? [];

  for (const [name, scheme] of Object.entries(document.components?.securitySchemes ?? {})) {
    metadata.securitySchemes[name] = {
      description: capText(scheme.description),
      bearerFormat: scheme.bearerFormat,
      flowNames: Object.keys(scheme.flows ?? {}).sort((a, b) => a.localeCompare(b)),
      openIdConnectUrl: scheme.openIdConnectUrl,
    };
  }

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    // Path-level parameter descriptions apply to every operation under the
    // path, exactly as path-level parameters themselves do.
    const pathParameters = z.array(parameterDocSchema).safeParse(pathItem.parameters ?? []);
    const pathParameterDocs: Record<string, OpenApiParameterDoc> = {};
    if (pathParameters.success) {
      for (const parameter of pathParameters.data) {
        pathParameterDocs[`${parameter.in}:${parameter.name}`] = toParameterDoc(parameter);
      }
    }

    for (const [key, value] of Object.entries(pathItem)) {
      const method = key.toUpperCase();
      if (!METHOD_SET.has(method)) continue;

      const operation = operationDocSchema.safeParse(value);
      if (!operation.success) continue;
      const data = operation.data;

      const parameters: Record<string, OpenApiParameterDoc> = { ...pathParameterDocs };
      for (const parameter of data.parameters ?? []) {
        parameters[`${parameter.in}:${parameter.name}`] = toParameterDoc(parameter);
      }

      const responseDescriptions: Record<string, string> = {};
      const responseHeaderDescriptions: Record<string, string> = {};
      const responseExamples: Record<string, OpenApiExample[]> = {};

      for (const [status, response] of Object.entries(data.responses ?? {})) {
        const description = capText(response.description);
        if (description !== undefined) responseDescriptions[status.trim()] = description;

        for (const [headerName, header] of Object.entries(response.headers ?? {})) {
          const headerDescription = capText(header.description);
          if (headerDescription !== undefined) {
            responseHeaderDescriptions[`${status.trim()}:${headerName}`] = headerDescription;
          }
        }

        const examples = extractMediaExamples(response.content);
        if (examples.length > 0) responseExamples[status.trim()] = examples;
      }

      metadata.operations[`${method} ${path}`] = {
        summary: capText(data.summary),
        description: capText(data.description),
        deprecated: data.deprecated === true,
        tags: data.tags ?? [],
        parameters,
        requestBodyDescription: capText(data.requestBody?.description),
        requestExamples: extractMediaExamples(data.requestBody?.content),
        responseDescriptions,
        responseHeaderDescriptions,
        responseExamples,
        securitySchemeNames: securitySchemeNames(data.security),
      };
    }
  }

  return metadata;
}

function toParameterDoc(parameter: z.infer<typeof parameterDocSchema>): OpenApiParameterDoc {
  // A parameter's `default` lives on its schema, not on the parameter — a
  // detail that is easy to get wrong and produces silently empty columns.
  const schema = parameter.schema;
  const defaultValue =
    typeof schema === "object" && schema !== null
      ? stringifyExample((schema as Record<string, unknown>).default)
      : undefined;

  // A named `examples` map is preferred over a bare `example` only when the
  // latter is absent; documents commonly carry both, and the bare one is the
  // canonical single value.
  let example = stringifyExample(parameter.example);
  if (example === undefined) {
    const first = Object.keys(parameter.examples ?? {}).sort((a, b) => a.localeCompare(b))[0];
    if (first !== undefined) example = stringifyExample(parameter.examples?.[first]?.value);
  }

  return {
    description: capText(parameter.description),
    example,
    defaultValue,
  };
}
