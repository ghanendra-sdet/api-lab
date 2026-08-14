import { MAX_SEARCH_INDEX_ENTRIES } from "../limits.ts";
import { endpointId, schemaId } from "../id.ts";
import type { Documentation } from "../types.ts";

/**
 * The client-side search index for generated HTML (spec §27, §30).
 *
 * ## Constraints this design answers
 *
 * - **No server** (spec §30). The output has to work from a `file://` URL, so
 *   the index ships inside the page.
 * - **No large search infrastructure** (spec §27). No Lunr, no FlexSearch, no
 *   inverted index, no stemming. A flat array plus `String.includes` is
 *   sub-millisecond at the sizes this generator produces, and it adds zero
 *   dependencies to a file that gets emailed around.
 * - **Searchable by path, method, auth, schema name, tag** (spec §30). Each
 *   entry carries a single pre-lowercased `haystack` string containing all of
 *   those, so the matcher is one `includes` call rather than five.
 *
 * ## Why the index is data and the matcher is a constant
 *
 * `SEARCH_SCRIPT` below is a fixed string authored here. Not one byte of it
 * is derived from the source document. Everything document-derived goes
 * through `serializeForScript` into a JSON literal — which escapes `<` and
 * `>` so a description containing `</script>` cannot terminate the element.
 *
 * That separation is the entire security argument for embedding a script at
 * all: the code is ours and constant, the data is theirs and inert. The
 * matcher also writes results via `textContent` and `setAttribute`, never
 * `innerHTML`, so a matching title cannot become markup on the way to the
 * screen even if it reached the page as data.
 */

export interface SearchEntry {
  /** Fragment anchor, e.g. "get-users-id". */
  id: string;
  /** Display label. */
  title: string;
  /** Secondary label — method, or "Schema". */
  kind: string;
  /** Pre-lowercased concatenation of every searchable field. */
  haystack: string;
}

export function buildSearchIndex(documentation: Documentation): SearchEntry[] {
  const entries: SearchEntry[] = [];

  for (const group of documentation.groups) {
    for (const endpoint of group.endpoints) {
      if (entries.length >= MAX_SEARCH_INDEX_ENTRIES) return entries;

      const parts = [
        endpoint.method,
        endpoint.path,
        endpoint.summary ?? "",
        endpoint.operationId ?? "",
        group.name,
        ...endpoint.authentication.map((scheme) => scheme.name),
        ...endpoint.parameters.map((parameter) => parameter.name),
        // Schema names referenced by this endpoint, so searching "User" finds
        // the endpoints that return one and not only the schema itself.
        ...endpoint.responses.flatMap((response) =>
          response.content.map((media) =>
            media.schema !== undefined && media.schema.kind === "object" ? media.schema.name ?? "" : "",
          ),
        ),
      ];

      entries.push({
        id: endpointId(endpoint.method, endpoint.path),
        title: `${endpoint.method} ${endpoint.path}`,
        kind: endpoint.method,
        haystack: parts.join(" ").toLowerCase(),
      });
    }
  }

  for (const schema of documentation.schemas) {
    if (entries.length >= MAX_SEARCH_INDEX_ENTRIES) return entries;
    entries.push({
      id: schemaId(schema.name),
      title: schema.name,
      kind: "Schema",
      haystack: `${schema.name} schema`.toLowerCase(),
    });
  }

  return entries;
}

/**
 * The search behaviour, as a fixed script.
 *
 * Written as an IIFE against `window.__API_LAB_DOCS_INDEX__`, which the page
 * defines immediately above it from the serialized index. Results are built
 * with `createElement` + `textContent`, never `innerHTML` — see the module
 * comment.
 *
 * The `data-testid` attributes exist for the Milestone 13 Playwright suite;
 * search that only works when a human drives it is search that regresses
 * silently.
 */
export const SEARCH_SCRIPT = `(function () {
  var index = window.__API_LAB_DOCS_INDEX__ || [];
  var input = document.getElementById("search");
  var results = document.getElementById("search-results");
  var empty = document.getElementById("search-empty");
  if (!input || !results || !empty) return;

  function render(matches, query) {
    while (results.firstChild) results.removeChild(results.firstChild);

    if (query === "") {
      empty.textContent = "";
      return;
    }
    if (matches.length === 0) {
      empty.textContent = "No matches.";
      return;
    }
    empty.textContent = "";

    for (var i = 0; i < matches.length; i++) {
      var entry = matches[i];
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.setAttribute("href", "#" + entry.id);
      a.setAttribute("data-testid", "search-result");
      // textContent only — an endpoint summary is document-derived, and this
      // must never become markup.
      a.textContent = entry.kind + "  " + entry.title;
      li.appendChild(a);
      results.appendChild(li);
    }
  }

  input.addEventListener("input", function () {
    var query = input.value.trim().toLowerCase();
    if (query === "") {
      render([], "");
      return;
    }
    var matches = [];
    for (var i = 0; i < index.length && matches.length < 50; i++) {
      if (index[i].haystack.indexOf(query) !== -1) matches.push(index[i]);
    }
    render(matches, query);
  });
})();`;
