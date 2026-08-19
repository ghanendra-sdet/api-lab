import { buildRequest, validateJsonBody, validateUrl } from "@api-lab/request-engine";
import { buildVariableContext, resolveRequestConfig, type Environment } from "@api-lab/environment-engine";
import { applyAuth, validateAuthConfig } from "@api-lab/auth-engine";
import {
  validateTargetUrl,
  type PerfRequestSpec,
} from "@api-lab/performance-engine";
import type { RequestConfig, RequestLocation, Workspace } from "@api-lab/workspace-engine";
import { resolveAuthConfig } from "./authResolve";
import { resolveInheritedAuth } from "./authInheritance";
import { resolveContainers } from "./workspaceLookup";
import type { RunnableRequest } from "./runner";

export type BuildSpecsResult =
  | { ok: true; specs: PerfRequestSpec[] }
  | { ok: false; error: string };

/**
 * Turns saved requests into the load profile handed to the performance
 * worker.
 *
 * ## Why resolution happens here, in the browser (spec §12, §13)
 *
 * Environments and authorization live in the browser's workspace state, and
 * they must stay there. Resolving `{{baseUrl}}` and applying an API key /
 * Basic / Bearer / JWT header at *this* point means:
 *   - the URL is generated at execution time, from the environment selected
 *     for this run, exactly as spec §12 requires;
 *   - the worker process never receives, stores, or logs the environment
 *     itself — only the finished header values it must replay; and
 *   - nothing resolved is ever persisted (spec §12, §42): these specs live
 *     in memory for the duration of one run.
 *
 * ## What is deliberately NOT resolved
 *
 * Runtime variables produced by M8 extractions (`{{token}}` from a login
 * response) cannot be resolved here — their values do not exist yet, and
 * each virtual user must get its own. Those placeholders are passed through
 * untouched and substituted per virtual user inside the worker (spec §15).
 * A placeholder that no extraction in the chain produces is a configuration
 * error and is rejected up front, rather than firing thousands of requests
 * at a URL containing a literal "{{token}}".
 *
 * The saved request is never mutated (spec §10) — `resolveRequestConfig`
 * returns a copy and the originals keep their `{{name}}` expressions.
 */
export function buildPerfSpecs(
  requests: RunnableRequest[],
  environment: Environment | undefined,
  // Optional/defaulted so pre-Step-5 callers (and this file's own existing
  // tests, which don't exercise inheritance) keep compiling unchanged — an
  // empty workspace simply means `resolveContainers` finds no Folder/
  // Collection, so an `{type:"inherit"}` request auth falls back to "none",
  // exactly as it unconditionally did before Step 5.
  workspace: Workspace = { collections: [] },
): BuildSpecsResult {
  const context = buildVariableContext(environment);

  // The set of runtime variables this run can ever produce is known before
  // anything is built — it comes straight from the requests' extraction
  // rules. Computing it first means an unsatisfiable `{{name}}` is reported
  // with its own precise message, instead of surfacing later as a generic
  // "could not build this URL" once it reaches the URL parser.
  const produced = new Set<string>();
  for (const runnable of requests) {
    for (const extraction of runnable.request.extractions) {
      if (extraction.enabled) produced.add(extraction.variable);
    }
  }

  const specs: PerfRequestSpec[] = [];
  for (const runnable of requests) {
    const built = buildOne(runnable.id, runnable.name, runnable.request, runnable.location, workspace, context, produced);
    if (!built.ok) return built;
    specs.push(built.spec);
  }

  return { ok: true, specs };
}

type BuildOneResult = { ok: true; spec: PerfRequestSpec } | { ok: false; error: string };

function buildOne(
  id: string,
  name: string,
  config: RequestConfig,
  location: RequestLocation,
  workspace: Workspace,
  context: Record<string, string>,
  produced: ReadonlySet<string>,
): BuildOneResult {
  const resolution = resolveRequestConfig(
    { url: config.url, params: config.params, headers: config.headers, bodyRawContent: config.bodyRawContent },
    context,
  );

  if (resolution.hasCircularReference) {
    return { ok: false, error: `"${name}" has a circular variable reference. Fix the environment before running a load test.` };
  }

  // D.1 Step 5: same inheritance resolution as the request/runner pipeline
  // (see executeRequest.ts) — the containing Folder/Collection's auth is
  // consulted only when this request's own auth is `{type:"inherit"}`.
  const { collection, folder } = resolveContainers(workspace, location);
  const inheritedAuth = resolveInheritedAuth(config.auth, folder?.auth, collection?.auth);

  const authResolution = resolveAuthConfig(inheritedAuth, context);
  if (authResolution.hasCircularReference) {
    return { ok: false, error: `"${name}" has a circular variable reference in its authorization configuration.` };
  }

  const authError = validateAuthConfig(authResolution.resolved);
  if (authError) return { ok: false, error: `"${name}": ${authError.message}` };

  // Any variable left unresolved must be one a request in this run extracts
  // at runtime (spec §15). Anything else can never resolve, and firing a
  // load test at a URL containing a literal "{{name}}" is never what the
  // user meant.
  const unsatisfiable = [...new Set([...resolution.unresolvedVariables, ...authResolution.unresolvedVariables])].filter(
    (variable) => !produced.has(variable),
  );
  if (unsatisfiable.length > 0) {
    return {
      ok: false,
      error: `"${name}" references ${unsatisfiable.map((n) => `{{${n}}}`).join(", ")}, which the selected environment does not define and no request in this test extracts.`,
    };
  }

  const withAuth = applyAuth(authResolution.resolved, resolution.resolved.headers, resolution.resolved.params);

  const bodyError = validateJsonBody(config.bodyMode, config.bodyRawFormat, resolution.resolved.bodyRawContent);
  if (bodyError) return { ok: false, error: `"${name}": ${bodyError.message}` };

  // A URL that still contains an unresolved runtime placeholder cannot be
  // parsed or validated yet — it is re-checked by the worker after per-user
  // substitution. A URL with no placeholders must be a valid, absolute
  // http(s) target right now (spec §37, §38).
  //
  // Validation deliberately happens BEFORE buildRequest: `buildUrl` parses
  // with `new URL()` and throws on a relative or malformed URL, so checking
  // afterwards would surface a crash instead of a clear message.
  const stillTemplated = hasPlaceholder(resolution.resolved.url);
  if (!stillTemplated) {
    const urlError = validateUrl(resolution.resolved.url);
    if (urlError) return { ok: false, error: `"${name}": ${urlError.message}` };
    const targetError = validateTargetUrl(resolution.resolved.url);
    if (targetError) return { ok: false, error: `"${name}": ${targetError}` };
  }

  // `buildRequest` percent-encodes query parameter keys and values, which
  // would mangle a surviving `{{token}}` into `%7B%7Btoken%7D%7D` and stop
  // the worker's substitution from ever matching it. Placeholders are
  // therefore swapped for a URL-safe sentinel across the whole request
  // first, and restored immediately after — so encoding and substitution
  // both work, with no second URL builder to keep in sync.
  let built: ReturnType<typeof buildRequest>;
  try {
    built = buildRequest({
      id,
      name,
      method: config.method,
      url: mask(resolution.resolved.url),
      queryParams: withAuth.params.map((row) => ({ ...row, key: mask(row.key), value: mask(row.value) })),
      headers: withAuth.headers.map((row) => ({ ...row, key: mask(row.key), value: mask(row.value) })),
      // See executeRequest.ts's identical comment: resolveInheritedAuth
      // never actually returns "inherit"; this is a defensive fallback only.
      authType: inheritedAuth.type === "inherit" ? "none" : inheritedAuth.type,
      bodyMode: config.bodyMode,
      bodyRawFormat: config.bodyRawFormat,
      bodyRawContent: mask(resolution.resolved.bodyRawContent),
    });
  } catch {
    return {
      ok: false,
      error: `"${name}" could not be prepared: its URL is not a valid absolute http(s) address once variables are resolved.`,
    };
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(built.headers)) headers[unmask(key)] = unmask(value);

  return {
    ok: true,
    spec: {
      id,
      name,
      method: built.method,
      url: unmask(built.url),
      headers,
      body: (built.body === undefined || built.body instanceof FormData) ? null : unmask(built.body),
      extractions: config.extractions,
    },
  };
}

const PLACEHOLDER = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const SENTINEL = /__APILAB_VAR_([A-Za-z_][A-Za-z0-9_]*)__/g;

export function hasPlaceholder(input: string): boolean {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(input);
}

/** Rewrites `{{name}}` as a percent-encoding-safe sentinel so URL building
 * cannot corrupt it. See the call site for why this is necessary. */
function mask(input: string): string {
  return input.replace(PLACEHOLDER, (_match, name: string) => `__APILAB_VAR_${name}__`);
}

function unmask(input: string): string {
  return input.replace(SENTINEL, (_match, name: string) => `{{${name}}}`);
}

/** Every concrete target URL this run will touch, for the production-traffic
 * warning (spec §39). Templated URLs contribute their literal text, which is
 * never treated as local — an unknown host must always warn. */
export function targetUrls(specs: readonly PerfRequestSpec[]): string[] {
  return specs.map((spec) => spec.url);
}
