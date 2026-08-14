import type { RenderedDocument } from "@api-lab/documentation-engine";

/**
 * The documentation preview surface (spec §25, §32).
 *
 * ## Why an iframe, and why this exact sandbox
 *
 * Spec §25 forbids rendering untrusted API content as executable HTML and
 * says not to reach for `dangerouslySetInnerHTML` unless a proven sanitizer
 * genuinely requires it. This component takes the stronger option: it never
 * calls `dangerouslySetInnerHTML` at all, anywhere, and pulls in no sanitizer.
 *
 * The generated HTML is already escaped at source — `escapeHtml` in
 * `@api-lab/documentation-engine` is the only way a string becomes markup
 * there, and `htmlInjection.test.ts` pins that across sixteen fields. But
 * "already escaped" is an argument, and an argument is not a boundary. If the
 * preview injected that HTML into the app's own document, a single missed
 * escape anywhere in the engine would become script execution *inside API
 * Lab's origin*, with access to every collection, environment and stored
 * credential the app holds.
 *
 * So the preview renders into an iframe via `srcDoc`, with:
 *
 * - **`sandbox="allow-scripts"`** — and deliberately **not**
 *   `allow-same-origin`. Omitting it puts the frame in an opaque origin: it
 *   cannot read or write API Lab's `localStorage`, cannot touch
 *   `document.cookie`, cannot reach `window.parent`, and cannot issue
 *   same-origin requests. `allow-scripts` on its own is what makes the
 *   in-page endpoint search (spec §30) actually work in the preview, which is
 *   the behaviour the exported file has and the preview should honestly
 *   reproduce.
 *
 *   The two together are the combination that would be unsafe —
 *   `allow-scripts allow-same-origin` lets framed script remove its own
 *   sandbox attribute. They are never both set here.
 *
 * - **No `allow-forms`, `allow-popups`, `allow-top-navigation`, or
 *   `allow-modals`.** Generated documentation needs none of them, and each
 *   would be a way for a hostile specification to interrupt or redirect the
 *   user.
 *
 * The net effect: even in the hypothetical where the engine's escaping failed
 * completely, the worst outcome is script running in a sealed, origin-less
 * frame with nothing to steal.
 *
 * ## Markdown and JSON
 *
 * Rendered into a `<pre>` as text. React escapes text children, so there is
 * no injection path, and a reader wants to see the Markdown *source* — that
 * is the artifact being exported.
 */
export function DocumentationPreview({ rendered }: { rendered: RenderedDocument }) {
  if (rendered.format === "html") {
    return (
      <iframe
        title="Documentation preview"
        data-testid="documentation-preview-frame"
        srcDoc={rendered.content}
        // See the module comment: `allow-scripts` WITHOUT `allow-same-origin`
        // is load-bearing. Adding the latter would let framed script escape.
        sandbox="allow-scripts"
        className="h-full w-full rounded border border-neutral-200 bg-white dark:border-neutral-800"
      />
    );
  }

  return (
    <pre
      data-testid="documentation-preview-text"
      className="h-full w-full overflow-auto rounded border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs leading-relaxed text-neutral-800 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200"
    >
      {rendered.content}
    </pre>
  );
}
