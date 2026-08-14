import type { DocFormat, Documentation, RenderOptions, RenderedDocument } from "../types.ts";
import { renderHtml } from "./html.ts";
import { renderMarkdown } from "./markdown.ts";
import { renderJson } from "./json.ts";

export * from "./html.ts";
export * from "./markdown.ts";
export * from "./json.ts";
export * from "./styles.ts";
export * from "./searchIndex.ts";

/**
 * Renders a documentation model in the requested format.
 *
 * A single dispatch point so callers (the preview UI, the export action, the
 * tests) never branch on format themselves — adding a format later means
 * adding a case here rather than finding every `if (format === "html")` in
 * the application.
 */
export function renderDocumentation(
  documentation: Documentation,
  format: DocFormat,
  options: RenderOptions,
): RenderedDocument {
  switch (format) {
    case "html":
      return renderHtml(documentation, options);
    case "markdown":
      return renderMarkdown(documentation, options);
    case "json":
      return renderJson(documentation, options);
  }
}

/** The file name an exported document is offered under. */
export function documentationFileName(format: DocFormat): string {
  switch (format) {
    case "html":
      return "index.html";
    case "markdown":
      return "API.md";
    case "json":
      return "documentation.json";
  }
}
