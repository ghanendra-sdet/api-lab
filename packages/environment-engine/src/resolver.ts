import type { Environment } from "./types";

/**
 * Syntax: `{{name}}` where `name` is `[A-Za-z_][A-Za-z0-9_]*`. No whitespace
 * inside the braces is recognized — `{{ x }}` is left untouched, as is any
 * unterminated or malformed sequence (`{{`, `{{invalid`). This keeps the
 * resolver a strict, predictable string substitution rather than a parser
 * that has to guess intent from near-miss syntax.
 */
const VARIABLE_PATTERN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

/** Hard stop for pathological variable chains (a→b→c→…) that aren't a
 * strict cycle but would otherwise expand indefinitely. */
const MAX_RESOLUTION_DEPTH = 20;

export interface ResolveResult {
  /** The input with every resolvable `{{name}}` substituted. Unknown or
   * circular references are left as their literal `{{name}}` text. */
  value: string;
  /** Names referenced but not present (enabled) in the context. */
  unresolvedVariables: string[];
  /** True if resolving this input encountered a circular variable
   * reference, or exceeded the resolution depth safety net. */
  hasCircularReference: boolean;
}

interface ExpandResult {
  output: string;
  unresolved: Set<string>;
  circular: boolean;
}

function expand(input: string, context: Record<string, string>, visited: ReadonlySet<string>, depth: number): ExpandResult {
  if (depth > MAX_RESOLUTION_DEPTH) {
    return { output: input, unresolved: new Set(), circular: true };
  }

  const unresolved = new Set<string>();
  let circular = false;

  const output = input.replace(VARIABLE_PATTERN, (match, name: string) => {
    // Object.hasOwn (not `in`) so a variable literally named `__proto__` or
    // `constructor` can never be read off the prototype chain instead of
    // the context's own data — see docs/SECURITY.md's prototype-pollution
    // section. Combined with buildVariableContext's null-prototype objects,
    // such a variable is simply always "unresolved", never a crash or a
    // pollution vector.
    if (!Object.hasOwn(context, name)) {
      unresolved.add(name);
      return match;
    }
    if (visited.has(name)) {
      circular = true;
      return match;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(name);
    const nested = expand(context[name]!, context, nextVisited, depth + 1);
    if (nested.circular) circular = true;
    nested.unresolved.forEach((u) => unresolved.add(u));
    return nested.output;
  });

  return { output, unresolved, circular };
}

/** Pure, side-effect-free variable resolution. Never throws, never executes
 * a variable's value as code — it is always treated as opaque string data. */
export function resolveVariables(input: string, context: Record<string, string>): ResolveResult {
  const { output, unresolved, circular } = expand(input, context, new Set(), 0);
  return {
    value: output,
    unresolvedVariables: [...unresolved],
    hasCircularReference: circular,
  };
}

/** Flattens an environment's enabled variables into a resolution context.
 * Only the Environment scope is implemented in Milestone 4 — see
 * docs/ARCHITECTURE.md for the documented future scope precedence
 * (Local → Collection → Environment → Global), which callers can layer on
 * top of this context (later scopes just overwrite earlier keys in the
 * merged object) without any change to the resolver itself. */
export function buildVariableContext(environment: Environment | null | undefined): Record<string, string> {
  // Object.create(null): a variable keyed `__proto__`/`constructor` must
  // never reach the resolver by way of Object.prototype's accessors — see
  // docs/SECURITY.md.
  const context: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!environment) return context;
  for (const variable of environment.variables) {
    if (variable.enabled) context[variable.key] = variable.value;
  }
  return context;
}

const SECRET_MASK = "••••••••";

/**
 * Like `buildVariableContext`, but every `secret` variable's value is
 * replaced with a fixed mask before it ever enters the resolver. Intended
 * for UI previews (e.g. "resolved URL") that must never render a real
 * secret value, even transiently. The resolved *shape* (URL structure,
 * whether resolution would succeed) stays accurate; only secret content is
 * hidden.
 */
export function buildDisplayVariableContext(environment: Environment | null | undefined): Record<string, string> {
  const context: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!environment) return context;
  for (const variable of environment.variables) {
    if (variable.enabled) context[variable.key] = variable.secret ? SECRET_MASK : variable.value;
  }
  return context;
}
