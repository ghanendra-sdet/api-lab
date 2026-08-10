import type { BodyMode, BodyRawFormat } from "@api-lab/shared";

const RAW_FORMAT_CONTENT_TYPE: Record<BodyRawFormat, string> = {
  JSON: "application/json",
  Text: "text/plain",
  XML: "application/xml",
  HTML: "text/html",
};

export interface BuiltBody {
  body: string | undefined;
  /** Content-Type this body mode implies, or undefined if it doesn't imply one. */
  contentType: string | undefined;
}

/**
 * Milestone 2 supports "none" and "raw" (JSON/Text/XML/HTML) bodies only.
 * form-data and x-www-form-urlencoded have UI placeholders (Milestone 1) but
 * are not wired to execution — see docs/FEATURE-MATRIX.md.
 */
export function buildBody(
  bodyMode: BodyMode,
  bodyRawFormat: BodyRawFormat,
  bodyRawContent: string,
): BuiltBody {
  if (bodyMode === "raw" && bodyRawContent.trim() !== "") {
    return { body: bodyRawContent, contentType: RAW_FORMAT_CONTENT_TYPE[bodyRawFormat] };
  }
  return { body: undefined, contentType: undefined };
}
