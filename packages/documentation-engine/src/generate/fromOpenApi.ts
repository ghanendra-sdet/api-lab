import type {
  ContractModel,
  ContractOperation,
  ContractParameter,
  ContractResponse,
} from "@api-lab/contract-engine";
import { MAX_DOCUMENTED_OPERATIONS, MAX_DOCUMENTED_SCHEMAS, MAX_EXAMPLE_BYTES } from "../limits.ts";
import { capText, redactExampleBody, redactNamedValue } from "../redact.ts";
import { endpointId } from "../id.ts";
import { collectNamedSchemas, describeSchema, schemaTypeLabel } from "../schema/describe.ts";
import type { SchemaResolutionContext } from "../schema/describe.ts";
import type {
  DocAuthentication,
  DocEndpoint,
  DocExample,
  DocGroup,
  DocMediaType,
  DocParameter,
  DocRequestBody,
  DocResponse,
  DocServer,
  Documentation,
  DocumentedSchema,
} from "../types.ts";
import type { OpenApiDocMetadata, OpenApiExample, OpenApiOperationDoc } from "../source/openapiDoc.ts";

/**
 * OpenAPI → documentation model (spec §6).
 *
 * Consumes two inputs that describe the same document from different angles:
 *
 * - `contract` — Milestone 11's normalized `ContractModel`. Authoritative for
 *   *structure*: which operations exist, their parameters, their schemas
 *   (already normalized so 3.0 and 3.1 are indistinguishable downstream),
 *   their declared responses.
 * - `docMetadata` — Milestone 13's documentation projection. Authoritative
 *   for *prose*: descriptions, tags, examples, deprecation.
 *
 * Structure drives the walk and prose is looked up alongside it, never the
 * other way round. That ordering is what guarantees documentation cannot
 * describe an operation the contract model does not contain — an endpoint
 * page for an operation that failed structural validation would be exactly
 * the "silently invent API behavior" spec §2 forbids.
 */

const OAUTH_NOTE =
  "OAuth2 flow metadata is documented as declared. API Lab does not perform OAuth2 token acquisition.";

/**
 * Builds the usage line for a security scheme (spec §16).
 *
 * Placeholders only. There is no code path that produces a real token here —
 * this function receives no credential and has no access to one.
 */
function authenticationUsage(
  type: string,
  scheme: string | undefined,
  location: string | undefined,
  parameterName: string | undefined,
): string | undefined {
  if (type === "http") {
    if (scheme?.toLowerCase() === "bearer") return "Authorization: Bearer {{token}}";
    if (scheme?.toLowerCase() === "basic") return "Authorization: Basic {{base64(username:password)}}";
    return scheme === undefined ? undefined : `Authorization: ${scheme} {{credential}}`;
  }

  if (type === "apiKey" && parameterName !== undefined) {
    if (location === "query") return `?${parameterName}={{apiKey}}`;
    if (location === "cookie") return `Cookie: ${parameterName}={{apiKey}}`;
    return `${parameterName}: {{apiKey}}`;
  }

  if (type === "oauth2") return "Authorization: Bearer {{accessToken}}";

  return undefined;
}

/** Builds the document-level authentication list from the contract model. */
export function buildAuthentication(
  contract: ContractModel,
  docMetadata: OpenApiDocMetadata,
): DocAuthentication[] {
  return [...contract.securitySchemes]
    // Sorted for determinism (spec §33); documents rarely order these
    // meaningfully.
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((scheme) => {
      const extra = docMetadata.securitySchemes[scheme.name];

      const descriptionParts: string[] = [];
      if (extra?.description !== undefined) descriptionParts.push(extra.description);
      if (extra?.bearerFormat !== undefined) descriptionParts.push(`Bearer format: ${extra.bearerFormat}.`);
      if (scheme.type === "oauth2") {
        if (extra !== undefined && extra.flowNames.length > 0) {
          descriptionParts.push(`Flows: ${extra.flowNames.join(", ")}.`);
        }
        // Spec §15: document the scheme, do not pretend execution is
        // supported. Saying so in the output is the honest option.
        descriptionParts.push(OAUTH_NOTE);
      }
      if (scheme.type === "openIdConnect" && extra?.openIdConnectUrl !== undefined) {
        descriptionParts.push(`OpenID Connect discovery: ${extra.openIdConnectUrl}`);
      }

      return {
        name: scheme.name,
        type: scheme.type,
        scheme: scheme.scheme,
        location: scheme.location,
        parameterName: scheme.parameterName,
        description: descriptionParts.length > 0 ? descriptionParts.join(" ") : undefined,
        usage: authenticationUsage(scheme.type, scheme.scheme, scheme.location, scheme.parameterName),
        provenance: "openapi" as const,
      };
    });
}

function buildParameters(
  parameters: ContractParameter[],
  operationDoc: OpenApiOperationDoc | undefined,
  context: SchemaResolutionContext,
): DocParameter[] {
  return (
    [...parameters]
      // Path parameters first (they are structural), then required, then
      // alphabetical. Deterministic, and it matches how a reader thinks about
      // an endpoint.
      .sort((a, b) => {
        const locationRank = (location: string): number =>
          location === "path" ? 0 : location === "query" ? 1 : location === "header" ? 2 : 3;
        const byLocation = locationRank(a.location) - locationRank(b.location);
        if (byLocation !== 0) return byLocation;
        if (a.required !== b.required) return a.required ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((parameter) => {
        const described = describeSchema(parameter.schema, context);
        const extra = operationDoc?.parameters[`${parameter.location}:${parameter.name}`];

        const constraints = described.kind === "scalar" ? [...described.constraints] : [];
        if (described.kind === "scalar" && described.enumValues !== undefined) {
          constraints.push(`one of: ${described.enumValues.join(", ")}`);
        }
        if (parameter.unsupportedStyle !== undefined) {
          // Stated rather than hidden, matching contract-engine's rule that an
          // unsupported construct must never look like a supported one.
          constraints.push(`style: ${parameter.unsupportedStyle} (not applied by API Lab)`);
        }

        return {
          name: parameter.name,
          location: parameter.location,
          required: parameter.required,
          type: schemaTypeLabel(described),
          description: extra?.description,
          // A parameter named `api_key` routinely carries a real key in its
          // `default` or `example`. Both reach documentation through the prose
          // projection rather than through a body, so neither is covered by
          // redactExampleBody — the canary suite caught this.
          defaultValue: redactNamedValue(parameter.name, extra?.defaultValue),
          example: redactNamedValue(parameter.name, extra?.example),
          constraints,
          provenance: "openapi" as const,
        };
      })
  );
}

function buildMediaTypes(
  content: Array<{ contentType: string; schema: unknown }>,
  context: SchemaResolutionContext,
): DocMediaType[] {
  return [...content]
    .sort((a, b) => a.contentType.localeCompare(b.contentType))
    .map((media) => ({
      contentType: media.contentType,
      schema: describeSchema(media.schema as never, context),
    }));
}

function buildRequestBody(
  operation: ContractOperation,
  operationDoc: OpenApiOperationDoc | undefined,
  context: SchemaResolutionContext,
): DocRequestBody | undefined {
  if (operation.requestBody === undefined) return undefined;
  return {
    required: operation.requestBody.required,
    description: operationDoc?.requestBodyDescription,
    content: buildMediaTypes(operation.requestBody.content, context),
    provenance: "openapi",
  };
}

/**
 * Orders response status keys the way a reader expects: success codes first,
 * ascending, then errors, then ranges, then `default`.
 *
 * Documents order responses arbitrarily, and an endpoint page that leads with
 * `500` is a worse page. This is a display decision, so it lives here rather
 * than in the contract model — which deliberately preserves the document's
 * own ordering for validation.
 */
function responseRank(statusKey: string): number {
  if (statusKey === "default") return 4;
  if (/^\dxx$/i.test(statusKey)) return 3;
  const numeric = Number.parseInt(statusKey, 10);
  if (Number.isNaN(numeric)) return 3;
  if (numeric < 300) return 0;
  if (numeric < 400) return 1;
  return 2;
}

function buildResponses(
  responses: ContractResponse[],
  operationDoc: OpenApiOperationDoc | undefined,
  context: SchemaResolutionContext,
): DocResponse[] {
  return [...responses]
    .sort((a, b) => {
      const byRank = responseRank(a.statusKey) - responseRank(b.statusKey);
      if (byRank !== 0) return byRank;
      return a.statusKey.localeCompare(b.statusKey);
    })
    .map((response) => ({
      status: response.statusKey,
      description: operationDoc?.responseDescriptions[response.statusKey],
      headers: [...response.headers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((header) => ({
          name: header.name,
          required: header.required,
          type: schemaTypeLabel(describeSchema(header.schema, context)),
          description: operationDoc?.responseHeaderDescriptions[`${response.statusKey}:${header.name}`],
        })),
      content: buildMediaTypes(response.content, context),
      provenance: "openapi" as const,
    }));
}

/** Converts a document-declared example into a redacted `DocExample`. */
function toDocExample(
  example: OpenApiExample,
  kind: "request" | "response",
  titlePrefix: string,
): DocExample {
  // Declared examples are as untrusted as anything else in the document, and
  // specifications genuinely do ship examples containing real-looking tokens.
  const redacted = redactExampleBody(example.value, MAX_EXAMPLE_BYTES);
  return {
    title: example.summary === undefined ? titlePrefix : `${titlePrefix} — ${example.summary}`,
    kind,
    contentType: example.contentType,
    headers: [],
    body: redacted.body,
    truncated: redacted.truncated,
    provenance: "openapi",
  };
}

function buildExamples(operationDoc: OpenApiOperationDoc | undefined): DocExample[] {
  if (operationDoc === undefined) return [];

  const examples: DocExample[] = operationDoc.requestExamples.map((example) =>
    toDocExample(example, "request", "Request"),
  );

  for (const status of Object.keys(operationDoc.responseExamples).sort((a, b) => a.localeCompare(b))) {
    for (const example of operationDoc.responseExamples[status] ?? []) {
      examples.push(toDocExample(example, "response", `Response ${status}`));
    }
  }

  return examples;
}

/**
 * Resolves which security schemes apply to an operation.
 *
 * OpenAPI's rule: an operation-level `security` array overrides the document
 * level entirely, including an *empty* array, which means "this endpoint is
 * public". That empty-array case is the one implementations usually get
 * wrong, and getting it wrong means documenting a public endpoint as
 * requiring authentication. `securitySchemeNames` returns `undefined` for
 * "not declared" and `[]` for "declared empty" precisely so the two stay
 * distinguishable here.
 */
function operationAuthentication(
  operationDoc: OpenApiOperationDoc | undefined,
  globalNames: string[],
  all: DocAuthentication[],
): DocAuthentication[] {
  const names = operationDoc?.securitySchemeNames ?? globalNames;
  return all.filter((scheme) => names.includes(scheme.name));
}

/** Groups endpoints by OpenAPI tag, falling back to a single default group. */
function groupByTag(
  endpoints: Array<{ endpoint: DocEndpoint; tags: string[] }>,
  docMetadata: OpenApiDocMetadata,
): DocGroup[] {
  const byTag = new Map<string, DocEndpoint[]>();
  const untagged: DocEndpoint[] = [];

  for (const entry of endpoints) {
    if (entry.tags.length === 0) {
      untagged.push(entry.endpoint);
      continue;
    }
    // An operation with several tags appears under each, which is what tags
    // are for. The endpoint object is shared, and its id is stable, so HTML
    // anchors still resolve to a single canonical section.
    for (const tag of entry.tags) {
      const existing = byTag.get(tag);
      if (existing === undefined) byTag.set(tag, [entry.endpoint]);
      else existing.push(entry.endpoint);
    }
  }

  const groups: DocGroup[] = [];

  // Declared tag order first — a document that bothered to declare `tags` is
  // expressing a reading order, and alphabetising it would discard that.
  const declared = docMetadata.tags.map((tag) => tag.name);
  const seen = new Set<string>();
  for (const name of declared) {
    const tagEndpoints = byTag.get(name);
    if (tagEndpoints === undefined) continue;
    seen.add(name);
    groups.push({
      name,
      description: docMetadata.tags.find((tag) => tag.name === name)?.description,
      source: "tag",
      endpoints: tagEndpoints,
    });
  }

  for (const name of [...byTag.keys()].sort((a, b) => a.localeCompare(b))) {
    if (seen.has(name)) continue;
    groups.push({ name, description: undefined, source: "tag", endpoints: byTag.get(name) ?? [] });
  }

  if (untagged.length > 0) {
    groups.push({ name: "Other", description: undefined, source: "default", endpoints: untagged });
  }

  return groups;
}

export interface OpenApiGenerationOptions {
  /** When false, every operation lands in one "Endpoints" group. */
  groupByTags: boolean;
  generatedAt: string | undefined;
}

/**
 * Generates a documentation model from an OpenAPI source.
 *
 * Never throws. Truncations are recorded in `metadata.warnings` and are
 * always stated in the rendered output.
 */
export function generateFromOpenApi(
  contract: ContractModel,
  docMetadata: OpenApiDocMetadata,
  options: OpenApiGenerationOptions,
): Documentation {
  const context: SchemaResolutionContext = { components: contract.components };
  const warnings: string[] = [];

  const authentication = buildAuthentication(contract, docMetadata);

  const operations = contract.operations;
  if (operations.length > MAX_DOCUMENTED_OPERATIONS) {
    warnings.push(
      `The specification declares ${operations.length} operations; only the first ${MAX_DOCUMENTED_OPERATIONS} are documented.`,
    );
  }

  const built = operations.slice(0, MAX_DOCUMENTED_OPERATIONS).map((operation) => {
    const operationDoc = docMetadata.operations[operation.id];

    const endpoint: DocEndpoint = {
      id: endpointId(operation.method, operation.path),
      method: operation.method,
      path: operation.path,
      // The contract model already carries `summary`; the doc projection is
      // the fallback, not the primary, so the two cannot disagree.
      summary: capText(operation.summary) ?? operationDoc?.summary,
      description: operationDoc?.description,
      operationId: operation.operationId,
      deprecated: operationDoc?.deprecated ?? false,
      parameters: buildParameters(operation.parameters, operationDoc, context),
      request: buildRequestBody(operation, operationDoc, context),
      responses: buildResponses(operation.responses, operationDoc, context),
      examples: buildExamples(operationDoc),
      authentication: operationAuthentication(
        operationDoc,
        docMetadata.globalSecuritySchemeNames,
        authentication,
      ),
      contract: undefined,
      provenance: "openapi",
    };

    return { endpoint, tags: operationDoc?.tags ?? [] };
  });

  const groups = options.groupByTags
    ? groupByTag(built, docMetadata)
    : [
        {
          name: "Endpoints",
          description: undefined,
          source: "default",
          endpoints: built.map((entry) => entry.endpoint),
        },
      ];

  const namedSchemas = collectNamedSchemas(context, MAX_DOCUMENTED_SCHEMAS);
  if (namedSchemas.truncated) {
    warnings.push(`More than ${MAX_DOCUMENTED_SCHEMAS} schemas are declared; the remainder are not documented.`);
  }
  const schemas: DocumentedSchema[] = namedSchemas.schemas;

  // contract-engine's own parse warnings are carried through rather than
  // dropped: a specification whose schemas were partly unreadable produces
  // documentation with gaps, and hiding the reason would make those gaps look
  // like the API's own.
  warnings.push(...contract.warnings);

  const servers: DocServer[] = contract.servers.map((url) => ({
    url,
    description: docMetadata.serverDescriptions[url],
  }));

  return {
    title: docMetadata.title ?? contract.title,
    description: docMetadata.description,
    version: docMetadata.version,
    servers,
    authentication,
    groups,
    schemas,
    coverage: undefined,
    drift: undefined,
    metadata: {
      sources: ["openapi"],
      openapiVersion: contract.openapiVersionString,
      endpointCount: built.length,
      schemaCount: schemas.length,
      warnings: [...new Set(warnings)],
      generatedAt: options.generatedAt,
    },
  };
}
