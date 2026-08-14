import { MAX_DOCUMENTED_OPERATIONS, MAX_EXAMPLE_BYTES } from "../limits.ts";
import { capText, redactExampleBody, redactExampleHeaders, redactNamedValue } from "../redact.ts";
import { endpointId } from "../id.ts";
import {
  extractCollectionPath,
  extractCollectionServer,
  type DocCollectionAuth,
  type DocCollectionRequest,
  type DocCollectionSource,
} from "../source/collectionSource.ts";
import type {
  DocAuthentication,
  DocEndpoint,
  DocExample,
  DocGroup,
  DocParameter,
  DocResponse,
  Documentation,
} from "../types.ts";

/**
 * Collection → documentation model (spec §7).
 *
 * ## The honesty problem
 *
 * This generator is the one with an ethical constraint rather than merely a
 * technical one, and spec §7 states it: *do not claim that collection-derived
 * responses are contractual.*
 *
 * A saved request is evidence of what somebody once sent. It is not a
 * promise about what the API accepts. The difference matters enormously to a
 * reader: "the `status` query parameter accepts `active`" (a contract) and
 * "somebody sent `status=active` once" (an observation) look nearly identical
 * on a page and mean completely different things. Publishing the second as
 * the first is how generated documentation earns its reputation for being
 * confidently wrong.
 *
 * Three mechanisms keep that from happening here, none of which depend on the
 * renderer remembering anything:
 *
 * 1. Every fact produced carries `provenance: "collection"`, which both
 *    renderers print as "Source: Collection".
 * 2. Nothing is described as *required*. A collection cannot know that. Every
 *    `DocParameter.required` produced here is `false`, and the description
 *    says "observed in a saved request" rather than asserting anything.
 * 3. No `DocResponse` is synthesised from thin air. Responses appear only
 *    when the caller explicitly supplied a recorded one (spec §18), and they
 *    are labelled with their origin — including `mock` for Milestone 9
 *    scenarios (spec §19), which are deterministic fixtures and emphatically
 *    not the real API.
 *
 * Where the collection genuinely knows something — the method, the path, the
 * header names, the body shape actually sent — it is documented plainly,
 * because that is real information and a reader with no OpenAPI document is
 * better served by it than by nothing.
 */

const OBSERVED = "Observed in a saved request. Not part of a contract.";

/** Describes a collection request's auth without carrying a credential. */
function describeCollectionAuth(auth: DocCollectionAuth): DocAuthentication | undefined {
  if (auth.type === "none" || auth.type === "") return undefined;

  const usage =
    auth.type === "bearer"
      ? "Authorization: Bearer {{token}}"
      : auth.type === "basic"
        ? "Authorization: Basic {{base64(username:password)}}"
        : auth.type === "api-key" && auth.parameterName !== undefined
          ? auth.location === "query"
            ? `?${auth.parameterName}={{apiKey}}`
            : `${auth.parameterName}: {{apiKey}}`
          : undefined;

  return {
    name: auth.type,
    type: "collection",
    scheme: auth.type,
    location: auth.location,
    parameterName: auth.parameterName,
    description: `Configured on the saved request. ${OBSERVED}`,
    usage,
    provenance: "collection",
  };
}

/**
 * Derives parameters from what a request actually carries.
 *
 * Query parameter *names* are real information; their values are one person's
 * example. So the name and an example value are documented, the type is
 * "string" (which is all an HTTP query parameter is without a schema), and
 * `required` is false — see the module comment.
 *
 * Header parameters are filtered: `Content-Type` and `Authorization` are
 * documented by the request-body and authentication sections respectively,
 * and repeating them as parameters produces a table that is mostly noise.
 */
const HEADERS_DOCUMENTED_ELSEWHERE = new Set(["content-type", "authorization", "accept-encoding", "content-length"]);

function buildCollectionParameters(request: DocCollectionRequest, servers: string[]): DocParameter[] {
  const parameters: DocParameter[] = [];

  // Path templates in a collection URL are `{{variables}}`, which is how a
  // reader identifies the variable segments of the path.
  const pathVariables = [...extractCollectionPath(request.url, servers).matchAll(/\{\{([^{}]+)\}\}/g)].map(
    (match) => match[1] ?? "",
  );
  for (const name of [...new Set(pathVariables)].sort((a, b) => a.localeCompare(b))) {
    parameters.push({
      name,
      location: "path",
      required: true,
      type: "string",
      description: `Path variable. ${OBSERVED}`,
      defaultValue: undefined,
      example: undefined,
      constraints: [],
      provenance: "collection",
    });
  }

  for (const parameter of [...request.queryParams].sort((a, b) => a.name.localeCompare(b.name))) {
    parameters.push({
      name: parameter.name,
      location: "query",
      required: false,
      type: "string",
      description: OBSERVED,
      defaultValue: undefined,
      // Redacted by parameter *name*: a query string is the single most
      // common place for an API key to appear in a saved request, and the
      // value alone carries no shape a body-redactor could recognise.
      example: redactNamedValue(parameter.name, parameter.value),
      constraints: [],
      provenance: "collection",
    });
  }

  for (const header of [...request.headers].sort((a, b) => a.name.localeCompare(b.name))) {
    if (HEADERS_DOCUMENTED_ELSEWHERE.has(header.name.toLowerCase())) continue;
    parameters.push({
      name: header.name,
      location: "header",
      required: false,
      type: "string",
      description: OBSERVED,
      defaultValue: undefined,
      example: redactExampleHeaders([header])[0]?.value,
      constraints: [],
      provenance: "collection",
    });
  }

  return parameters;
}

function buildCollectionExamples(request: DocCollectionRequest): DocExample[] {
  const examples: DocExample[] = [];

  if (request.body !== undefined && request.body.trim() !== "") {
    const redacted = redactExampleBody(request.body, MAX_EXAMPLE_BYTES);
    examples.push({
      title: "Request",
      kind: "request",
      contentType: request.contentType,
      headers: redactExampleHeaders(request.headers.map((h) => ({ name: h.name, value: h.value }))),
      body: redacted.body,
      truncated: redacted.truncated,
      provenance: "collection",
    });
  }

  for (const recorded of request.recordedResponses) {
    const redacted =
      recorded.body === undefined
        ? { body: undefined, truncated: false }
        : redactExampleBody(recorded.body, MAX_EXAMPLE_BYTES);
    examples.push({
      title: `Response ${recorded.status}`,
      kind: "response",
      contentType: recorded.contentType,
      headers: redactExampleHeaders(recorded.headers.map((h) => ({ name: h.name, value: h.value }))),
      body: redacted.body,
      truncated: redacted.truncated,
      // Spec §19: mock-derived examples are labelled as mock-derived.
      provenance: recorded.origin === "mock" ? "mock" : "collection",
    });
  }

  return examples;
}

function buildCollectionResponses(request: DocCollectionRequest): DocResponse[] {
  // Only recorded responses become documented responses — nothing invented.
  return request.recordedResponses.map((recorded) => ({
    status: String(recorded.status),
    description:
      recorded.origin === "mock"
        ? "Produced by an API Lab mock scenario. Not a response from the real API."
        : `Recorded response. ${OBSERVED}`,
    headers: [],
    content:
      recorded.contentType === undefined ? [] : [{ contentType: recorded.contentType, schema: undefined }],
    provenance: recorded.origin === "mock" ? "mock" : "collection",
  }));
}

export interface CollectionGenerationOptions {
  /** When false, every request lands in one group named after the collection. */
  groupByFolder: boolean;
  includeExamples: boolean;
  /**
   * Server URLs whose base paths should be stripped from request paths.
   *
   * Empty for a collection-only source, and the specification's `servers` for
   * a combined one. Without this, `https://host/v1/orders` documents as
   * `/v1/orders` while the specification documents `/orders`, and the merge in
   * combine.ts pairs neither with the other — see extractCollectionPath.
   */
  serverBasePaths: string[];
  generatedAt: string | undefined;
}

export function generateFromCollection(
  source: DocCollectionSource,
  options: CollectionGenerationOptions,
): Documentation {
  const warnings: string[] = [];

  const requests = source.requests;
  if (requests.length > MAX_DOCUMENTED_OPERATIONS) {
    warnings.push(
      `The collection contains ${requests.length} requests; only the first ${MAX_DOCUMENTED_OPERATIONS} are documented.`,
    );
  }

  const endpoints = requests.slice(0, MAX_DOCUMENTED_OPERATIONS).map((request) => {
    const path = extractCollectionPath(request.url, options.serverBasePaths);
    const auth = describeCollectionAuth(request.auth);

    const endpoint: DocEndpoint = {
      id: endpointId(request.method, path),
      method: request.method,
      path,
      summary: capText(request.name),
      description: capText(request.description),
      operationId: undefined,
      deprecated: false,
      parameters: buildCollectionParameters(request, options.serverBasePaths),
      request:
        request.body === undefined || request.body.trim() === ""
          ? undefined
          : {
              required: false,
              description: OBSERVED,
              content: [{ contentType: request.contentType ?? "application/json", schema: undefined }],
              provenance: "collection",
            },
      responses: buildCollectionResponses(request),
      examples: options.includeExamples ? buildCollectionExamples(request) : [],
      authentication: auth === undefined ? [] : [auth],
      contract: undefined,
      provenance: "collection",
    };

    return { endpoint, folderName: request.folderName };
  });

  // Grouping precedence for a collection source (spec §28): folder, then the
  // collection itself. There are no tags to prefer.
  let groups: DocGroup[];
  if (options.groupByFolder) {
    const byFolder = new Map<string, DocEndpoint[]>();
    for (const entry of endpoints) {
      const key = entry.folderName ?? source.name;
      const existing = byFolder.get(key);
      if (existing === undefined) byFolder.set(key, [entry.endpoint]);
      else existing.push(entry.endpoint);
    }
    groups = [...byFolder.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({
        name,
        description: undefined,
        source: name === source.name ? "collection" : "folder",
        endpoints: byFolder.get(name) ?? [],
      }));
  } else {
    groups = [
      {
        name: source.name,
        description: undefined,
        source: "collection",
        endpoints: endpoints.map((entry) => entry.endpoint),
      },
    ];
  }

  // Servers are only those a request literally pointed at. A collection built
  // entirely on `{{baseUrl}}` documents no servers, which is correct — it
  // genuinely does not know one.
  const servers = [
    ...new Set(
      requests
        .map((request) => extractCollectionServer(request.url))
        // `.origin` is scheme + host + port by construction — userinfo and
        // query string are already gone, so there is nothing left to redact
        // and running redactDocUrl here would only append a trailing slash.
        .filter((url): url is string => url !== undefined),
    ),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((url) => ({ url, description: "Observed in a saved request." as string | undefined }));

  const documentAuth = new Map<string, DocAuthentication>();
  for (const entry of endpoints) {
    for (const scheme of entry.endpoint.authentication) {
      if (!documentAuth.has(scheme.name)) documentAuth.set(scheme.name, scheme);
    }
  }

  return {
    title: source.name,
    description: capText(source.description),
    version: undefined,
    servers,
    authentication: [...documentAuth.values()].sort((a, b) => a.name.localeCompare(b.name)),
    groups,
    // A collection carries no schema definitions. Spec §2 forbids inventing
    // them, and schema inference from example bodies would be exactly that.
    schemas: [],
    coverage: undefined,
    drift: undefined,
    metadata: {
      sources: ["collection"],
      openapiVersion: undefined,
      endpointCount: endpoints.length,
      schemaCount: 0,
      warnings: [...new Set(warnings)],
      generatedAt: options.generatedAt,
    },
  };
}
