import type { KeyValueRow } from "@api-lab/shared";
import type { AuthConfig } from "./types.ts";

export interface ApplyAuthResult {
  headers: KeyValueRow[];
  params: KeyValueRow[];
}

/**
 * Base64-encodes a "user:pass" pair for Basic auth, correctly handling
 * non-Latin1 characters (the standard btoa-can-only-do-Latin1 workaround).
 * Uses the global `btoa` — available in both browsers and Node 18+, so this
 * has no platform-specific branch and no Buffer dependency.
 */
function base64(raw: string): string {
  return btoa(unescape(encodeURIComponent(raw)));
}

let authRowCounter = 0;
function authRowId(): string {
  authRowCounter += 1;
  return `auth_row_${authRowCounter}`;
}

/**
 * Precedence rule (documented, deterministic): an auth-generated header or
 * query parameter always wins over a manually-entered one with the same
 * name — the manual row is dropped, not sent alongside a conflicting
 * duplicate. Header names are compared case-insensitively (HTTP header
 * names are case-insensitive); query parameter keys are compared exactly
 * (query keys are conventionally case-sensitive). This was chosen over
 * "manual wins" because a user who explicitly configures an auth type
 * almost always wants that credential actually sent — a stray manually
 * typed "Authorization" header silently winning would make the auth
 * configuration appear broken with no error shown anywhere.
 */
function upsert(rows: KeyValueRow[], key: string, value: string, caseInsensitive: boolean): KeyValueRow[] {
  const matches = (rowKey: string) => (caseInsensitive ? rowKey.toLowerCase() === key.toLowerCase() : rowKey === key);
  const withoutConflicts = rows.filter((row) => !matches(row.key));
  return [...withoutConflicts, { id: authRowId(), key, value, enabled: true }];
}

/**
 * Applies an (already variable-resolved — see types.ts) auth config on top
 * of the request's existing headers/params, per the precedence rule above.
 * Pure and side-effect-free; never mutates its inputs.
 */
export function applyAuth(config: AuthConfig, headers: KeyValueRow[], params: KeyValueRow[]): ApplyAuthResult {
  switch (config.type) {
    case "none":
    case "inherit":
    case "oauth2":
      return { headers, params };

    case "apiKey":
      return config.addTo === "header"
        ? { headers: upsert(headers, config.key, config.value, true), params }
        : { headers, params: upsert(params, config.key, config.value, false) };

    case "basic":
      return {
        headers: upsert(headers, "Authorization", `Basic ${base64(`${config.username}:${config.password}`)}`, true),
        params,
      };

    case "bearer":
    case "jwt":
      return { headers: upsert(headers, "Authorization", `Bearer ${config.token}`, true), params };
  }
}
