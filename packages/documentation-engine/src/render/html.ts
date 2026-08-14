import { MAX_HTML_BYTES } from "../limits.ts";
import { escapeHtml, serializeForScript } from "../escape.ts";
import { endpointId, groupId, schemaId } from "../id.ts";
import { schemaTypeLabel } from "../schema/describe.ts";
import { buildSearchIndex, SEARCH_SCRIPT } from "./searchIndex.ts";
import { DOCUMENTATION_STYLESHEET } from "./styles.ts";
import {
  PROVENANCE_LABELS,
  PROVENANCE_NAMES,
  type DocEndpoint,
  type DocExample,
  type Documentation,
  type RenderOptions,
  type RenderedDocument,
  type SchemaDescription,
} from "../types.ts";

/**
 * Documentation model → static HTML site (spec §24, §25, §27, §30).
 *
 * ## The escaping discipline
 *
 * Every document-derived string in this file passes through `escapeHtml`
 * before it is concatenated into markup. Every one — endpoint descriptions,
 * schema descriptions, parameter names, example bodies, group names,
 * collection names, warning text. There is no exception, no "this field is
 * safe" shortcut, and no sanitizer to be misconfigured.
 *
 * The single place a document-derived value is *not* HTML-escaped is the
 * search index, which is serialized as a JSON literal by
 * `serializeForScript` — a stronger treatment for that position, because
 * `escapeHtml` would corrupt the JSON while leaving the real `</script>`
 * breakout risk unaddressed. See escape.ts.
 *
 * `htmlInjection.test.ts` drives `<script>alert(1)</script>` through eight
 * distinct fields and asserts none of them produce an executable tag.
 *
 * ## Why strings and not a DOM
 *
 * The engine is framework-independent and must run in Node (tests, and any
 * future CLI) as well as in the browser. There is no `document` to build
 * against. Concatenating strings makes the escaping obligation visible at
 * every call site, which is the property that matters here.
 *
 * ## Single file, plus assets
 *
 * `index.html` carries the whole document; `assets/styles.css` is emitted as
 * a companion (spec §24) and also inlined, so the page renders correctly
 * whether it is opened as part of the exported directory or on its own. The
 * duplication costs a few kilobytes and removes an entire class of "the
 * export looks broken" report.
 */

class HtmlBuilder {
  private readonly parts: string[] = [];
  private length = 0;
  truncated = false;

  push(text: string): void {
    if (this.truncated) return;
    if (this.length + text.length > MAX_HTML_BYTES) {
      this.parts.push('<p class="note">Output truncated: the generated document exceeded the size limit.</p>');
      this.truncated = true;
      return;
    }
    this.parts.push(text);
    this.length += text.length;
  }

  toString(): string {
    return this.parts.join("");
  }
}

/** The CSS class for an HTTP method badge (spec §9). */
function methodClass(method: string): string {
  return `method method-${method.toLowerCase()}`;
}

function renderSchemaHtml(schema: SchemaDescription): string {
  switch (schema.kind) {
    case "object": {
      const description =
        schema.description === undefined ? "" : `<p class="muted">${escapeHtml(schema.description)}</p>`;
      if (schema.properties.length === 0) {
        return `${description}<p class="muted">No declared properties.</p>`;
      }
      const items = schema.properties
        .map((property) => {
          const requirement = property.required
            ? '<span class="badge">required</span>'
            : '<span class="badge">optional</span>';
          const nested =
            property.schema.kind === "object" ||
            property.schema.kind === "union" ||
            (property.schema.kind === "array" && property.schema.items?.kind === "object")
              ? renderSchemaHtml(property.schema)
              : property.schema.kind === "reference"
                ? `<span class="schema-ref">${escapeHtml(property.schema.name)} → ${escapeHtml(property.schema.note)}</span>`
                : "";
          const detail =
            property.schema.kind === "scalar" && property.schema.constraints.length > 0
              ? ` <span class="muted">${escapeHtml(property.schema.constraints.join(" · "))}</span>`
              : "";
          return `<li><code>${escapeHtml(property.name)}</code> — ${escapeHtml(schemaTypeLabel(property.schema))} ${requirement}${detail}${nested}</li>`;
        })
        .join("");
      const truncated = schema.truncated
        ? '<li class="muted">Further properties omitted — limit reached.</li>'
        : "";
      return `${description}<ul class="schema-tree">${items}${truncated}</ul>`;
    }
    case "array": {
      const label = schema.items === undefined ? "any" : schemaTypeLabel(schema.items);
      const nested =
        schema.items !== undefined && (schema.items.kind === "object" || schema.items.kind === "union")
          ? renderSchemaHtml(schema.items)
          : "";
      return `<p>Array of ${escapeHtml(label)}.</p>${nested}`;
    }
    case "scalar": {
      const bits = [schema.type];
      if (schema.format !== undefined) bits.push(`format: ${schema.format}`);
      if (schema.enumValues !== undefined) bits.push(`one of: ${schema.enumValues.join(", ")}`);
      bits.push(...schema.constraints);
      const description =
        schema.description === undefined ? "" : `<p class="muted">${escapeHtml(schema.description)}</p>`;
      return `<p><code>${escapeHtml(bits.join(" · "))}</code></p>${description}`;
    }
    case "union": {
      const options = schema.options
        .map((option) => `<li>${escapeHtml(schemaTypeLabel(option))}${renderSchemaHtml(option)}</li>`)
        .join("");
      return `<p><code>${escapeHtml(schema.combinator)}</code></p><ul class="schema-tree">${options}</ul>`;
    }
    case "reference":
      // The spec §14 circular-schema representation.
      return `<p class="schema-ref">${escapeHtml(schema.name)} → ${escapeHtml(schema.note)}</p>`;
    case "unknown":
      return `<p class="muted">${escapeHtml(schema.note)}</p>`;
  }
}

function renderExamplesHtml(examples: DocExample[]): string {
  if (examples.length === 0) return "";
  const blocks = examples
    .map((example) => {
      const headers =
        example.headers.length === 0
          ? ""
          : `<pre><code>${escapeHtml(example.headers.map((h) => `${h.name}: ${h.value}`).join("\n"))}</code></pre>`;
      const body =
        example.body === undefined ? "" : `<pre><code>${escapeHtml(example.body)}</code></pre>`;
      const truncated = example.truncated ? '<p class="muted">Example truncated.</p>' : "";
      return `<h4>${escapeHtml(example.title)} <span class="badge">${escapeHtml(PROVENANCE_LABELS[example.provenance])}</span></h4>${headers}${body}${truncated}`;
    })
    .join("");
  return `<h4>Examples</h4>${blocks}`;
}

function renderEndpointHtml(endpoint: DocEndpoint, options: RenderOptions): string {
  const parts: string[] = [];
  const anchor = endpointId(endpoint.method, endpoint.path);

  parts.push(`<div class="endpoint" id="${escapeHtml(anchor)}" data-testid="endpoint">`);
  parts.push(
    `<h3><span class="${methodClass(endpoint.method)}">${escapeHtml(endpoint.method)}</span><span class="path">${escapeHtml(endpoint.path)}</span>${
      endpoint.deprecated ? '<span class="badge badge-deprecated">deprecated</span>' : ""
    }<span class="badge">${escapeHtml(PROVENANCE_LABELS[endpoint.provenance])}</span></h3>`,
  );

  if (endpoint.summary !== undefined) parts.push(`<p><strong>${escapeHtml(endpoint.summary)}</strong></p>`);
  if (endpoint.description !== undefined) parts.push(`<p>${escapeHtml(endpoint.description)}</p>`);
  if (endpoint.operationId !== undefined) {
    parts.push(`<p class="muted">Operation ID: <code>${escapeHtml(endpoint.operationId)}</code></p>`);
  }

  if (options.sections.authentication && endpoint.authentication.length > 0) {
    const rows = endpoint.authentication
      .map(
        (scheme) =>
          `<li><strong>${escapeHtml(scheme.name)}</strong> (${escapeHtml(scheme.type)})${
            scheme.usage === undefined ? "" : ` — <code>${escapeHtml(scheme.usage)}</code>`
          }</li>`,
      )
      .join("");
    parts.push(`<h4>Authentication</h4><ul>${rows}</ul>`);
  }

  if (endpoint.parameters.length > 0) {
    const rows = endpoint.parameters
      .map(
        (parameter) =>
          `<tr><td><code>${escapeHtml(parameter.name)}</code></td><td>${escapeHtml(parameter.location)}</td><td>${escapeHtml(parameter.type)}</td><td>${
            parameter.required ? "yes" : "no"
          }</td><td>${parameter.defaultValue === undefined ? "—" : `<code>${escapeHtml(parameter.defaultValue)}</code>`}</td><td>${
            parameter.example === undefined ? "—" : `<code>${escapeHtml(parameter.example)}</code>`
          }</td><td>${
            parameter.constraints.length === 0 ? "—" : escapeHtml(parameter.constraints.join("; "))
          }</td><td>${parameter.description === undefined ? "—" : escapeHtml(parameter.description)}</td></tr>`,
      )
      .join("");
    parts.push(
      `<h4>Parameters</h4><table><thead><tr><th>Name</th><th>In</th><th>Type</th><th>Required</th><th>Default</th><th>Example</th><th>Constraints</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>`,
    );
  }

  if (endpoint.request !== undefined) {
    const media = endpoint.request.content
      .map(
        (entry) =>
          `<p><code>${escapeHtml(entry.contentType)}</code></p>${
            entry.schema === undefined ? "" : renderSchemaHtml(entry.schema)
          }`,
      )
      .join("");
    parts.push(
      `<h4>Request body</h4><p>${endpoint.request.required ? "Required" : "Optional"}.${
        endpoint.request.description === undefined ? "" : ` ${escapeHtml(endpoint.request.description)}`
      }</p>${media}`,
    );
  }

  if (endpoint.responses.length > 0) {
    const blocks = endpoint.responses
      .map((response) => {
        const headers =
          response.headers.length === 0
            ? ""
            : `<ul>${response.headers
                .map(
                  (header) =>
                    `<li><code>${escapeHtml(header.name)}</code> — ${escapeHtml(header.type)}${
                      header.required ? " (required)" : ""
                    }${header.description === undefined ? "" : ` — ${escapeHtml(header.description)}`}</li>`,
                )
                .join("")}</ul>`;
        const media = response.content
          .map(
            (entry) =>
              `<p><code>${escapeHtml(entry.contentType)}</code></p>${
                entry.schema === undefined ? "" : renderSchemaHtml(entry.schema)
              }`,
          )
          .join("");
        return `<h4>${escapeHtml(response.status)}</h4><p>${escapeHtml(
          response.description ?? "No description.",
        )}</p>${headers}${media}`;
      })
      .join("");
    parts.push(`<h4>Responses</h4>${blocks}`);
  }

  if (options.sections.examples) parts.push(renderExamplesHtml(endpoint.examples));

  if (options.sections.contractStatus && endpoint.contract !== undefined) {
    parts.push(
      `<p class="muted" data-testid="endpoint-contract-status">Contract status: ${escapeHtml(
        endpoint.contract.alignment,
      )}${endpoint.contract.detail === undefined ? "" : ` — ${escapeHtml(endpoint.contract.detail)}`}</p>`,
    );
  }

  parts.push("</div>");
  return parts.join("");
}

/** The sidebar navigation required by spec §27. */
function renderNavigation(documentation: Documentation, options: RenderOptions): string {
  const parts: string[] = ['<nav class="sidebar">'];

  if (options.includeSearch) {
    parts.push(
      '<h2>Search</h2><label class="muted" for="search">Search endpoints</label><input id="search" type="search" placeholder="path, method, schema…" data-testid="doc-search" autocomplete="off" /><ul id="search-results" data-testid="search-results"></ul><p id="search-empty"></p>',
    );
  }

  const sections: string[] = [];
  if (options.sections.overview) sections.push('<li><a href="#overview">API Overview</a></li>');
  if (options.sections.authentication && documentation.authentication.length > 0) {
    sections.push('<li><a href="#authentication">Authentication</a></li>');
  }
  if (options.sections.schemas && documentation.schemas.length > 0) {
    sections.push('<li><a href="#schemas">Schemas</a></li>');
  }
  if (options.sections.contractStatus && (documentation.coverage !== undefined || documentation.drift !== undefined)) {
    sections.push('<li><a href="#contract-status">Contract Status</a></li>');
  }
  if (sections.length > 0) parts.push(`<h2>Sections</h2><ul>${sections.join("")}</ul>`);

  if (options.sections.endpoints) {
    for (const group of documentation.groups) {
      const links = group.endpoints
        .map(
          (endpoint) =>
            `<li><a href="#${escapeHtml(endpointId(endpoint.method, endpoint.path))}"><span class="${methodClass(
              endpoint.method,
            )}">${escapeHtml(endpoint.method)}</span> ${escapeHtml(endpoint.path)}</a></li>`,
        )
        .join("");
      parts.push(
        `<h2><a href="#${escapeHtml(groupId(group.name))}">${escapeHtml(group.name)}</a></h2><ul>${links}</ul>`,
      );
    }
  }

  parts.push("</nav>");
  return parts.join("");
}

export function renderHtml(documentation: Documentation, options: RenderOptions): RenderedDocument {
  const builder = new HtmlBuilder();

  builder.push('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />');
  builder.push('<meta name="viewport" content="width=device-width, initial-scale=1" />');
  builder.push(`<title>${escapeHtml(documentation.title)}</title>`);
  // Inlined as well as emitted as an asset — see the module comment.
  builder.push(`<style>${DOCUMENTATION_STYLESHEET}</style>`);
  builder.push('</head><body><div class="layout">');

  builder.push(renderNavigation(documentation, options));
  builder.push("<main>");

  builder.push(`<h1>${escapeHtml(documentation.title)}</h1>`);

  if (options.sections.overview) {
    builder.push('<section id="overview">');
    if (documentation.version !== undefined) {
      builder.push(`<p class="muted">Version ${escapeHtml(documentation.version)}</p>`);
    }
    if (documentation.description !== undefined) {
      builder.push(`<p>${escapeHtml(documentation.description)}</p>`);
    }

    if (documentation.servers.length > 0) {
      const rows = documentation.servers
        .map(
          (server) =>
            `<li><code>${escapeHtml(server.url)}</code>${
              server.description === undefined ? "" : ` — ${escapeHtml(server.description)}`
            }</li>`,
        )
        .join("");
      builder.push(`<h2>Servers</h2><ul>${rows}</ul>`);
    }

    builder.push("<h2>Overview</h2>");
    builder.push(
      `<ul data-testid="doc-overview"><li>Endpoints: ${documentation.metadata.endpointCount}</li><li>Schemas: ${
        documentation.metadata.schemaCount
      }</li>${
        documentation.metadata.openapiVersion === undefined
          ? ""
          : `<li>OpenAPI: ${escapeHtml(documentation.metadata.openapiVersion)}</li>`
      }<li>Sources: ${escapeHtml(
        documentation.metadata.sources.map((source) => PROVENANCE_NAMES[source]).join(", "),
      )}</li>${
        documentation.metadata.generatedAt === undefined
          ? ""
          : `<li>Generated: ${escapeHtml(documentation.metadata.generatedAt)}</li>`
      }</ul>`,
    );

    if (documentation.metadata.warnings.length > 0) {
      const rows = documentation.metadata.warnings
        .map((warning) => `<li>${escapeHtml(warning)}</li>`)
        .join("");
      builder.push(`<div class="note"><strong>Generation notes</strong><ul>${rows}</ul></div>`);
    }
    builder.push("</section>");
  }

  if (options.sections.authentication && documentation.authentication.length > 0) {
    builder.push('<section id="authentication"><h2>Authentication</h2>');
    // Spec §15/§16 — stated in the output, not only in the code.
    builder.push(
      '<div class="note">Credential values are never included in generated documentation. Placeholders such as <code>{{token}}</code> mark where your own credential goes.</div>',
    );
    for (const scheme of documentation.authentication) {
      builder.push(`<h3>${escapeHtml(scheme.name)}</h3><ul>`);
      builder.push(
        `<li>Type: ${escapeHtml(scheme.type)}${scheme.scheme === undefined ? "" : ` (${escapeHtml(scheme.scheme)})`}</li>`,
      );
      if (scheme.location !== undefined) builder.push(`<li>In: ${escapeHtml(scheme.location)}</li>`);
      if (scheme.parameterName !== undefined) {
        builder.push(`<li>Name: <code>${escapeHtml(scheme.parameterName)}</code></li>`);
      }
      if (scheme.usage !== undefined) {
        builder.push(`<li>Usage: <code>${escapeHtml(scheme.usage)}</code></li>`);
      }
      if (scheme.description !== undefined) builder.push(`<li>${escapeHtml(scheme.description)}</li>`);
      builder.push("</ul>");
    }
    builder.push("</section>");
  }

  if (options.sections.endpoints) {
    builder.push('<section id="endpoints">');
    for (const group of documentation.groups) {
      builder.push(`<h2 id="${escapeHtml(groupId(group.name))}">${escapeHtml(group.name)}</h2>`);
      if (group.description !== undefined) builder.push(`<p>${escapeHtml(group.description)}</p>`);
      for (const endpoint of group.endpoints) {
        builder.push(renderEndpointHtml(endpoint, options));
      }
    }
    builder.push("</section>");
  }

  if (options.sections.schemas && documentation.schemas.length > 0) {
    builder.push('<section id="schemas"><h2>Schemas</h2>');
    for (const schema of documentation.schemas) {
      builder.push(
        `<h3 id="${escapeHtml(schemaId(schema.name))}" data-testid="schema">${escapeHtml(schema.name)}</h3>`,
      );
      builder.push(renderSchemaHtml(schema.description));
    }
    builder.push("</section>");
  }

  if (options.sections.contractStatus && (documentation.coverage !== undefined || documentation.drift !== undefined)) {
    builder.push('<section id="contract-status"><h2>Contract Status</h2>');

    if (documentation.coverage !== undefined) {
      builder.push("<h3>Coverage (QA metadata)</h3>");
      // Spec §21 — coverage is not a quality claim, and the output says so.
      builder.push(
        '<div class="note">These figures describe how much of the specification this collection exercises. They are not a measure of API quality.</div>',
      );
      builder.push(
        `<ul data-testid="doc-coverage"><li>Documented operations: ${documentation.coverage.totalOperations}</li><li>Operation coverage: ${documentation.coverage.coveredOperations} (${documentation.coverage.operationCoveragePercent}%)</li><li>Contract-validated: ${documentation.coverage.validatedOperations} (${documentation.coverage.validationCoveragePercent}%)</li></ul>`,
      );
    }

    if (documentation.drift !== undefined) {
      builder.push("<h3>Drift</h3>");
      builder.push(
        `<ul data-testid="doc-drift"><li>Aligned: ${documentation.drift.matched}</li><li>Missing from specification: ${documentation.drift.missingFromSpec}</li><li>Missing from collection: ${documentation.drift.missingFromCollection}</li><li>Mismatched: ${documentation.drift.mismatched}</li></ul>`,
      );
      if (documentation.drift.entries.length > 0) {
        const rows = documentation.drift.entries
          .map(
            (entry) =>
              `<tr><td>${escapeHtml(entry.method)}</td><td><code>${escapeHtml(entry.path)}</code></td><td>${escapeHtml(
                entry.alignment,
              )}</td><td>${escapeHtml(entry.detail)}</td></tr>`,
          )
          .join("");
        builder.push(
          `<table><thead><tr><th>Method</th><th>Path</th><th>Alignment</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>`,
        );
      }
    }

    builder.push("</section>");
  }

  builder.push("</main></div>");

  if (options.includeSearch) {
    // Data first, as an inert JSON literal; then the fixed matcher. Neither
    // half interpolates document text into executable position.
    builder.push(
      `<script>window.__API_LAB_DOCS_INDEX__ = ${serializeForScript(buildSearchIndex(documentation))};</script>`,
    );
    builder.push(`<script>${SEARCH_SCRIPT}</script>`);
  }

  builder.push("</body></html>");

  return {
    format: "html",
    content: builder.toString(),
    assets: [{ path: "assets/styles.css", content: DOCUMENTATION_STYLESHEET }],
    truncated: builder.truncated,
  };
}
