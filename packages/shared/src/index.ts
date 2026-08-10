/**
 * Domain types shared between the web app and future engine packages.
 * This package holds types only — no request-execution, storage, or
 * business logic. Those belong to their own engine packages when the
 * milestone that needs them arrives (see docs/ROADMAP.md).
 */

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** A single row in a key/value editor (Params, Headers). */
export interface KeyValueRow {
  id: string;
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
}

export const AUTH_TYPES = [
  "none",
  "apiKey",
  "basic",
  "bearer",
  "jwt",
  "oauth2",
] as const;

export type AuthType = (typeof AUTH_TYPES)[number];

export const BODY_MODES = ["none", "form-data", "x-www-form-urlencoded", "raw"] as const;

export type BodyMode = (typeof BODY_MODES)[number];

export const BODY_RAW_FORMATS = ["JSON", "Text", "XML", "HTML"] as const;

export type BodyRawFormat = (typeof BODY_RAW_FORMATS)[number];

export type RequestPanelId =
  | "params"
  | "auth"
  | "headers"
  | "body"
  | "scripts"
  | "tests";

export type ThemeMode = "light" | "dark";
