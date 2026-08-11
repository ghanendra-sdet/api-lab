import type { HttpMethod } from "@api-lab/shared";
import type { ContractModel, OperationMatchResult } from "./types.ts";

/**
 * Operation resolution (spec §6, §27).
 *
 * Given a concrete request like `GET /users/123`, find the operation the
 * contract documents it as — `GET /users/{id}` — without ever confusing it
 * with a sibling like `GET /users/list`.
 *
 * Matching is deterministic and specificity-ordered, never first-wins:
 * a literal segment always beats a template segment at the same position.
 * `/users/list` and `/users/{id}` both structurally match the path
 * `/users/list`, and OpenAPI's own resolution rules say the literal wins.
 * Ambiguity that specificity cannot break is reported as ambiguity rather
 * than guessed at, because spec §27 requires exactly that.
 */

export interface PathSegment {
  value: string;
  isTemplate: boolean;
}

/** Splits a path into segments, ignoring leading/trailing slashes. */
export function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

export function parsePathTemplate(template: string): PathSegment[] {
  return splitPath(template).map((segment) => {
    const isTemplate = segment.startsWith("{") && segment.endsWith("}") && segment.length > 2;
    return { value: isTemplate ? segment.slice(1, -1) : segment, isTemplate };
  });
}

/**
 * Extracts the path portion of a request URL, stripping any documented
 * server base path.
 *
 * A saved request's URL is typically the full `http://host/api/v1/users/1`
 * while the contract documents `/users/1` under a server of
 * `http://host/api/v1`. Comparing without removing the server prefix would
 * fail to match every operation in such a document.
 */
export function extractRequestPath(url: string, servers: string[]): string {
  let path = url;

  // Strip scheme+authority when present. A relative URL is used as-is.
  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.exec(url);
  if (schemeMatch) {
    const afterScheme = url.slice(schemeMatch[0].length);
    const slash = afterScheme.indexOf("/");
    path = slash === -1 ? "/" : afterScheme.slice(slash);
  }

  // Drop query and fragment — neither participates in operation resolution.
  const queryIndex = path.search(/[?#]/);
  if (queryIndex !== -1) path = path.slice(0, queryIndex);

  // Remove the longest matching server base path, so the most specific
  // server wins when a document lists both `/` and `/api/v1`.
  const basePaths = servers
    .map((server) => serverBasePath(server))
    .filter((base) => base !== "" && base !== "/")
    .sort((a, b) => b.length - a.length);

  for (const base of basePaths) {
    if (path === base) return "/";
    if (path.startsWith(`${base}/`)) return path.slice(base.length);
  }

  return path === "" ? "/" : path;
}

function serverBasePath(server: string): string {
  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.exec(server);
  let remainder = server;
  if (schemeMatch) {
    const afterScheme = server.slice(schemeMatch[0].length);
    const slash = afterScheme.indexOf("/");
    remainder = slash === -1 ? "" : afterScheme.slice(slash);
  }
  // Server URLs may themselves be templated (`https://{host}/v1`); only the
  // literal path tail is usable as a prefix.
  return remainder.replace(/\/+$/, "");
}

/** Structural match, ignoring specificity. */
function segmentsMatch(template: PathSegment[], actual: string[]): boolean {
  if (template.length !== actual.length) return false;
  return template.every((segment, index) => segment.isTemplate || segment.value === actual[index]);
}

/**
 * Specificity score: literal segments are worth more than template ones,
 * weighted by position so that an earlier literal outranks a later one.
 * This makes `/users/list` beat `/users/{id}` deterministically.
 */
function specificity(template: PathSegment[]): number {
  return template.reduce((score, segment, index) => {
    if (segment.isTemplate) return score;
    return score + (template.length - index) * 2;
  }, 0);
}

export function extractPathParameters(template: string, actualPath: string): Record<string, string> {
  const segments = parsePathTemplate(template);
  const actual = splitPath(actualPath);
  const params: Record<string, string> = Object.create(null) as Record<string, string>;

  segments.forEach((segment, index) => {
    if (!segment.isTemplate) return;
    const value = actual[index];
    if (value === undefined) return;
    if (segment.value === "__proto__" || segment.value === "constructor") return;
    try {
      params[segment.value] = decodeURIComponent(value);
    } catch {
      params[segment.value] = value; // Malformed percent-encoding: use as-is.
    }
  });

  return params;
}

/**
 * Resolves a method + concrete path to a single documented operation.
 *
 * Returns a typed outcome for every failure mode rather than `null`, because
 * "this path is not in the contract" and "this path exists but not for POST"
 * are different contract violations and the UI must be able to say which.
 */
export function resolveOperation(
  contract: ContractModel,
  method: HttpMethod,
  requestPath: string,
): OperationMatchResult {
  const actual = splitPath(requestPath);

  const structural = contract.operations.filter((operation) =>
    segmentsMatch(parsePathTemplate(operation.path), actual),
  );

  if (structural.length === 0) {
    return {
      status: "unknown-path",
      detail: `No operation in the specification matches the path "${requestPath}".`,
    };
  }

  const byMethod = structural.filter((operation) => operation.method === method);
  if (byMethod.length === 0) {
    const allowedMethods = [...new Set(structural.map((operation) => operation.method))].sort();
    return {
      status: "unknown-method",
      detail: `The specification documents ${allowedMethods.join(", ")} for this path, but not ${method}.`,
      allowedMethods,
    };
  }

  if (byMethod.length === 1) return { status: "matched", operation: byMethod[0]! };

  const ranked = [...byMethod].sort(
    (a, b) => specificity(parsePathTemplate(b.path)) - specificity(parsePathTemplate(a.path)),
  );
  const best = ranked[0]!;
  const runnerUp = ranked[1]!;

  if (specificity(parsePathTemplate(best.path)) === specificity(parsePathTemplate(runnerUp.path))) {
    // Two equally specific templates, e.g. `/users/{id}` and `/users/{name}`.
    // Nothing in the request distinguishes them, so guessing would silently
    // validate against a contract the user never intended (spec §27).
    return {
      status: "ambiguous",
      candidates: ranked,
      detail: `Contract operation could not be uniquely determined — ${ranked
        .map((operation) => `${operation.method} ${operation.path}`)
        .join(" and ")} both match.`,
    };
  }

  return { status: "matched", operation: best };
}
