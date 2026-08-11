import type { HttpMethod } from "@api-lab/shared";
import type { MockRoute } from "./types.ts";

/** Only a fixed, safe segment syntax is allowed — never a user-supplied
 * regular expression (ReDoS risk). A segment is either a literal
 * (alphanumeric, `-`, `_`, `.`) or a `:name` parameter placeholder. */
const VALID_PATH = /^\/([A-Za-z0-9_.\-]+|:[A-Za-z_][A-Za-z0-9_]*)(\/([A-Za-z0-9_.\-]+|:[A-Za-z_][A-Za-z0-9_]*))*\/?$/;

export function isValidMockPath(path: string): boolean {
  if (path === "/") return true;
  return VALID_PATH.test(path);
}

function segments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

export interface RouteMatch {
  route: MockRoute;
  params: Record<string, string>;
}

/**
 * Matches a real incoming request against the registered routes.
 * Precedence (documented, deterministic — see spec §30): among routes with
 * the same segment count, a fully static route always wins over one with
 * any `:param` segment, regardless of registration order; ties beyond that
 * resolve to registration order (array order), never randomly.
 */
export function matchRoute(routes: MockRoute[], method: HttpMethod, path: string): RouteMatch | null {
  const requestSegments = segments(path);
  const candidates = routes
    .filter((r) => r.enabled && r.method === method)
    .map((route) => ({ route, routeSegments: segments(route.path) }))
    .filter(({ routeSegments }) => routeSegments.length === requestSegments.length);

  let best: { route: MockRoute; params: Record<string, string>; paramCount: number } | null = null;

  for (const { route, routeSegments } of candidates) {
    const params: Record<string, string> = Object.create(null) as Record<string, string>;
    let paramCount = 0;
    let ok = true;

    for (let i = 0; i < routeSegments.length; i++) {
      const routeSeg = routeSegments[i]!;
      const reqSeg = requestSegments[i]!;
      if (routeSeg.startsWith(":")) {
        params[routeSeg.slice(1)] = decodeURIComponent(reqSeg);
        paramCount += 1;
      } else if (routeSeg !== reqSeg) {
        ok = false;
        break;
      }
    }

    if (!ok) continue;
    if (best === null || paramCount < best.paramCount) {
      best = { route, params, paramCount };
    }
  }

  return best ? { route: best.route, params: best.params } : null;
}
