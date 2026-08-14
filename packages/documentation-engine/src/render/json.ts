import type { Documentation, RenderOptions, RenderedDocument } from "../types.ts";

/**
 * Documentation model → JSON (spec §23).
 *
 * Spec §23 asks whether a JSON documentation model is worth having as an
 * internal/export format. It is, for one specific reason that HTML and
 * Markdown cannot serve: it is the only output another tool can consume.
 * A team that wants to render API Lab's documentation model through their own
 * templates, diff two versions of an API structurally, or feed a docs
 * pipeline needs the model, not a rendering of it.
 *
 * ## Sections are not applied
 *
 * Deliberately. `sections` is a *presentation* filter — see the note on
 * `DocSections` in types.ts — and a machine-readable export that silently
 * omitted schemas because a checkbox in the preview UI happened to be off
 * would be a data-loss bug wearing a feature's clothes. The JSON export is
 * always complete, and the caller filters if it wants to.
 *
 * ## Determinism
 *
 * `JSON.stringify` preserves insertion order, and every array and object in
 * the model was built in a deterministic order by the generators, so this
 * output is byte-stable for a given input like the other two (spec §33).
 */
export function renderJson(documentation: Documentation, _options: RenderOptions): RenderedDocument {
  return {
    format: "json",
    content: JSON.stringify(documentation, null, 2),
    assets: [],
    truncated: false,
  };
}
