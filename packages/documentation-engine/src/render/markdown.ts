import { MAX_MARKDOWN_BYTES } from "../limits.ts";
import { escapeMarkdownCell, fencedCodeBlock } from "../escape.ts";
import { endpointId, schemaId } from "../id.ts";
import { schemaTypeLabel } from "../schema/describe.ts";
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
 * Documentation model → Markdown (spec §26).
 *
 * Targets GitHub/GitLab-flavoured Markdown, because that is where generated
 * API documentation actually gets committed: a `docs/` directory, a wiki, a
 * repository README. That target dictates two constraints:
 *
 * - **Tables for parameters.** Pipe tables are the one table syntax every
 *   Markdown renderer in that ecosystem supports.
 * - **No raw HTML.** Some renderers strip it, some sanitize it, some execute
 *   it. Emitting none means the output renders identically everywhere and
 *   carries no injection surface of its own — a description containing
 *   `<script>` lands inside a table cell as literal text and stays literal
 *   text wherever it is viewed.
 *
 * Determinism (spec §33) is inherited rather than re-established: the model
 * is already fully ordered by the generators, so this renderer walks it in
 * order and never sorts, dedupes, or times anything.
 */

/** Accumulates output and enforces the size ceiling in one place. */
class MarkdownBuilder {
  private readonly parts: string[] = [];
  private length = 0;
  truncated = false;

  push(text: string): void {
    if (this.truncated) return;
    if (this.length + text.length > MAX_MARKDOWN_BYTES) {
      this.parts.push("\n\n> **Output truncated.** The generated document exceeded the size limit.\n");
      this.truncated = true;
      return;
    }
    this.parts.push(text);
    this.length += text.length;
  }

  line(text = ""): void {
    this.push(`${text}\n`);
  }

  blank(): void {
    this.push("\n");
  }

  toString(): string {
    return this.parts.join("");
  }
}

/** Renders a schema description as an indented bullet tree (spec §13). */
function renderSchemaMarkdown(
  schema: SchemaDescription,
  builder: MarkdownBuilder,
  indent: string,
): void {
  switch (schema.kind) {
    case "object": {
      if (schema.description !== undefined) builder.line(`${indent}${schema.description}`);
      if (schema.properties.length === 0) {
        builder.line(`${indent}- _(no declared properties)_`);
      }
      for (const property of schema.properties) {
        const requirement = property.required ? "**required**" : "optional";
        builder.line(
          `${indent}- \`${property.name}\` — ${schemaTypeLabel(property.schema)}, ${requirement}`,
        );
        renderNested(property.schema, builder, `${indent}  `);
      }
      if (schema.truncated) {
        builder.line(`${indent}- _(further properties omitted — limit reached)_`);
      }
      break;
    }
    case "array": {
      builder.line(`${indent}Array of ${schema.items === undefined ? "any" : schemaTypeLabel(schema.items)}.`);
      if (schema.items !== undefined) renderNested(schema.items, builder, `${indent}  `);
      break;
    }
    case "scalar": {
      const bits: string[] = [schema.type];
      if (schema.format !== undefined) bits.push(`format: ${schema.format}`);
      if (schema.enumValues !== undefined) bits.push(`one of: ${schema.enumValues.join(", ")}`);
      bits.push(...schema.constraints);
      builder.line(`${indent}${bits.join(" · ")}`);
      if (schema.description !== undefined) builder.line(`${indent}${schema.description}`);
      break;
    }
    case "union": {
      builder.line(`${indent}\`${schema.combinator}\`:`);
      for (const option of schema.options) {
        builder.line(`${indent}- ${schemaTypeLabel(option)}`);
        renderNested(option, builder, `${indent}  `);
      }
      break;
    }
    case "reference": {
      // The spec §14 representation, rendered literally.
      builder.line(`${indent}${schema.name} → ${schema.note}`);
      break;
    }
    case "unknown": {
      builder.line(`${indent}_${schema.note}_`);
      break;
    }
  }
}

/**
 * Expands a nested schema only when there is something worth expanding.
 *
 * Without this guard every scalar property emits a redundant second line
 * repeating the type already shown on its bullet, which triples the length of
 * a large schema section and makes it unreadable — the outcome spec §13 warns
 * against.
 */
function renderNested(schema: SchemaDescription, builder: MarkdownBuilder, indent: string): void {
  if (schema.kind === "object" || schema.kind === "union") {
    renderSchemaMarkdown(schema, builder, indent);
    return;
  }
  if (schema.kind === "array" && schema.items !== undefined && schema.items.kind === "object") {
    renderSchemaMarkdown(schema, builder, indent);
    return;
  }
  if (schema.kind === "reference") {
    builder.line(`${indent}- ${schema.name} → ${schema.note}`);
  }
}

function renderExamples(examples: DocExample[], builder: MarkdownBuilder, heading: string): void {
  if (examples.length === 0) return;
  builder.line(heading);
  builder.blank();
  for (const example of examples) {
    builder.line(`**${escapeMarkdownCell(example.title)}** — ${PROVENANCE_LABELS[example.provenance]}`);
    builder.blank();
    if (example.headers.length > 0) {
      builder.line(
        fencedCodeBlock(
          example.headers.map((header) => `${header.name}: ${header.value}`).join("\n"),
          "http",
        ),
      );
      builder.blank();
    }
    if (example.body !== undefined) {
      const language = example.contentType?.includes("json") === true ? "json" : "";
      builder.line(fencedCodeBlock(example.body, language));
      if (example.truncated) builder.line("_(example truncated)_");
      builder.blank();
    }
  }
}

function renderEndpoint(endpoint: DocEndpoint, builder: MarkdownBuilder, options: RenderOptions): void {
  const deprecated = endpoint.deprecated ? " _(deprecated)_" : "";
  builder.line(`### \`${endpoint.method}\` ${endpoint.path}${deprecated}`);
  builder.blank();
  builder.line(`<a id="${endpointId(endpoint.method, endpoint.path)}"></a>`);
  builder.blank();

  if (endpoint.summary !== undefined) {
    builder.line(`**${escapeMarkdownCell(endpoint.summary)}**`);
    builder.blank();
  }
  if (endpoint.description !== undefined) {
    builder.line(endpoint.description);
    builder.blank();
  }

  builder.line(`_${PROVENANCE_LABELS[endpoint.provenance]}_`);
  builder.blank();

  if (options.sections.authentication && endpoint.authentication.length > 0) {
    builder.line("**Authentication**");
    builder.blank();
    for (const scheme of endpoint.authentication) {
      const usage = scheme.usage === undefined ? "" : ` — \`${scheme.usage}\``;
      builder.line(`- ${scheme.name} (${scheme.type})${usage}`);
    }
    builder.blank();
  }

  if (endpoint.parameters.length > 0) {
    builder.line("**Parameters**");
    builder.blank();
    builder.line("| Name | In | Type | Required | Default | Example | Constraints | Description |");
    builder.line("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const parameter of endpoint.parameters) {
      const cells = [
        `\`${escapeMarkdownCell(parameter.name)}\``,
        parameter.location,
        escapeMarkdownCell(parameter.type),
        parameter.required ? "yes" : "no",
        parameter.defaultValue === undefined ? "—" : `\`${escapeMarkdownCell(parameter.defaultValue)}\``,
        parameter.example === undefined ? "—" : `\`${escapeMarkdownCell(parameter.example)}\``,
        parameter.constraints.length === 0 ? "—" : escapeMarkdownCell(parameter.constraints.join("; ")),
        parameter.description === undefined ? "—" : escapeMarkdownCell(parameter.description),
      ];
      builder.line(`| ${cells.join(" | ")} |`);
    }
    builder.blank();
  }

  if (endpoint.request !== undefined) {
    builder.line("**Request body**");
    builder.blank();
    builder.line(`${endpoint.request.required ? "Required" : "Optional"}.`);
    if (endpoint.request.description !== undefined) builder.line(endpoint.request.description);
    builder.blank();
    for (const media of endpoint.request.content) {
      builder.line(`Content-Type: \`${media.contentType}\``);
      builder.blank();
      if (media.schema !== undefined) renderSchemaMarkdown(media.schema, builder, "");
      builder.blank();
    }
  }

  if (endpoint.responses.length > 0) {
    builder.line("**Responses**");
    builder.blank();
    for (const response of endpoint.responses) {
      builder.line(`- **${response.status}** — ${response.description ?? "No description."}`);
      for (const header of response.headers) {
        builder.line(`  - Header \`${header.name}\` (${header.type}${header.required ? ", required" : ""})`);
      }
      for (const media of response.content) {
        builder.line(`  - \`${media.contentType}\``);
        if (media.schema !== undefined) renderSchemaMarkdown(media.schema, builder, "    ");
      }
    }
    builder.blank();
  }

  if (options.sections.examples) {
    renderExamples(endpoint.examples, builder, "**Examples**");
  }

  if (options.sections.contractStatus && endpoint.contract !== undefined) {
    builder.line(
      `**Contract status:** ${endpoint.contract.alignment}${endpoint.contract.detail === undefined ? "" : ` — ${endpoint.contract.detail}`}`,
    );
    builder.blank();
  }
}

export function renderMarkdown(documentation: Documentation, options: RenderOptions): RenderedDocument {
  const builder = new MarkdownBuilder();

  builder.line(`# ${documentation.title}`);
  builder.blank();

  if (options.sections.overview) {
    if (documentation.version !== undefined) {
      builder.line(`**Version:** ${documentation.version}`);
      builder.blank();
    }
    if (documentation.description !== undefined) {
      builder.line(documentation.description);
      builder.blank();
    }

    if (documentation.servers.length > 0) {
      builder.line("## Servers");
      builder.blank();
      for (const server of documentation.servers) {
        builder.line(`- \`${server.url}\`${server.description === undefined ? "" : ` — ${server.description}`}`);
      }
      builder.blank();
    }

    builder.line("## Overview");
    builder.blank();
    builder.line(`- Endpoints: ${documentation.metadata.endpointCount}`);
    builder.line(`- Schemas: ${documentation.metadata.schemaCount}`);
    if (documentation.metadata.openapiVersion !== undefined) {
      builder.line(`- OpenAPI: ${documentation.metadata.openapiVersion}`);
    }
    builder.line(
      `- Sources: ${documentation.metadata.sources.map((source) => PROVENANCE_NAMES[source]).join(", ")}`,
    );
    if (documentation.metadata.generatedAt !== undefined) {
      builder.line(`- Generated: ${documentation.metadata.generatedAt}`);
    }
    builder.blank();

    if (documentation.metadata.warnings.length > 0) {
      builder.line("### Generation notes");
      builder.blank();
      for (const warning of documentation.metadata.warnings) {
        builder.line(`- ${warning}`);
      }
      builder.blank();
    }
  }

  if (options.sections.authentication && documentation.authentication.length > 0) {
    builder.line("## Authentication");
    builder.blank();
    // Spec §15/§16: the usage line is a placeholder, and this note says so, so
    // nobody copies a documentation page expecting a working credential.
    builder.line(
      "_Credential values are never included in generated documentation. Placeholders such as `{{token}}` mark where your own credential goes._",
    );
    builder.blank();
    for (const scheme of documentation.authentication) {
      builder.line(`### ${scheme.name}`);
      builder.blank();
      builder.line(`- Type: ${scheme.type}${scheme.scheme === undefined ? "" : ` (${scheme.scheme})`}`);
      if (scheme.location !== undefined) builder.line(`- In: ${scheme.location}`);
      if (scheme.parameterName !== undefined) builder.line(`- Name: \`${scheme.parameterName}\``);
      if (scheme.usage !== undefined) builder.line(`- Usage: \`${scheme.usage}\``);
      if (scheme.description !== undefined) builder.line(`- ${scheme.description}`);
      builder.blank();
    }
  }

  if (options.sections.endpoints) {
    builder.line("## Endpoints");
    builder.blank();
    for (const group of documentation.groups) {
      builder.line(`## ${group.name}`);
      builder.blank();
      if (group.description !== undefined) {
        builder.line(group.description);
        builder.blank();
      }
      for (const endpoint of group.endpoints) {
        renderEndpoint(endpoint, builder, options);
      }
    }
  }

  if (options.sections.schemas && documentation.schemas.length > 0) {
    builder.line("## Schemas");
    builder.blank();
    for (const schema of documentation.schemas) {
      builder.line(`### ${schema.name}`);
      builder.blank();
      builder.line(`<a id="${schemaId(schema.name)}"></a>`);
      builder.blank();
      renderSchemaMarkdown(schema.description, builder, "");
      builder.blank();
    }
  }

  if (options.sections.contractStatus) {
    if (documentation.coverage !== undefined) {
      builder.line("## Contract coverage (QA metadata)");
      builder.blank();
      // Spec §21: labelled as QA metadata and explicitly not a quality claim.
      builder.line(
        "_These figures describe how much of the specification this collection exercises. They are not a measure of API quality._",
      );
      builder.blank();
      builder.line(`- Documented operations: ${documentation.coverage.totalOperations}`);
      builder.line(
        `- Operation coverage: ${documentation.coverage.coveredOperations} (${documentation.coverage.operationCoveragePercent}%)`,
      );
      builder.line(
        `- Contract-validated: ${documentation.coverage.validatedOperations} (${documentation.coverage.validationCoveragePercent}%)`,
      );
      builder.blank();
    }

    if (documentation.drift !== undefined) {
      builder.line("## Contract drift");
      builder.blank();
      builder.line(`- Aligned: ${documentation.drift.matched}`);
      builder.line(`- Missing from specification: ${documentation.drift.missingFromSpec}`);
      builder.line(`- Missing from collection: ${documentation.drift.missingFromCollection}`);
      builder.line(`- Mismatched: ${documentation.drift.mismatched}`);
      builder.blank();
      if (documentation.drift.entries.length > 0) {
        builder.line("| Method | Path | Alignment | Detail |");
        builder.line("| --- | --- | --- | --- |");
        for (const entry of documentation.drift.entries) {
          builder.line(
            `| ${entry.method} | \`${escapeMarkdownCell(entry.path)}\` | ${entry.alignment} | ${escapeMarkdownCell(entry.detail)} |`,
          );
        }
        builder.blank();
      }
    }
  }

  return {
    format: "markdown",
    content: builder.toString(),
    assets: [],
    truncated: builder.truncated,
  };
}
