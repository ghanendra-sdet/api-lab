import { create } from "zustand";
import type { CoverageReport, DriftReport } from "@api-lab/contract-engine";
import {
  createDefaultDocumentationConfig,
  createEmptyDocumentationWorkspace,
  generateDocumentation,
  renderDocumentation,
  type DocCollectionSource,
  type DocFormat,
  type DocGroupingMode,
  type DocSections,
  type DocSourceKind,
  type Documentation,
  type DocumentationConfig,
  type DocumentationWorkspace,
  type RenderedDocument,
} from "@api-lab/documentation-engine";
import { createId } from "../lib/id";
import {
  loadDocumentationFromStorage,
  resetDocumentationStorage,
  saveDocumentationToStorage,
} from "../lib/documentationPersistence";

/**
 * Documentation configuration, the generated model, and the rendered preview.
 *
 * A store of its own rather than more fields on `useAppStore`, matching the
 * Milestone 9/10/11/12 precedent (`useMockStore`, `usePerfStore`,
 * `useContractStore`, `useSecurityStore`): documentation state has its own
 * lifecycle, its own persistence key, and no overlap with tab or workspace
 * state.
 *
 * Like `useSecurityStore`, it takes no dependency on `useAppStore`. The
 * caller supplies the specification source and the adapted collection at
 * generation time, so this store never reaches into collections or
 * environments itself — which is what keeps the credential boundary sharp
 * (see `lib/documentationAdapt.ts`).
 *
 * ## Generation is an explicit action, never a render side effect
 *
 * Spec §36 is direct about this: do not perform heavy rendering on every
 * React render. So `documentation` and `rendered` are state, produced by an
 * explicit `generate()` call wired to a button, and never derived inside a
 * component body or a `useMemo` over changing inputs. A 500-operation
 * specification takes real milliseconds to render; doing that on every
 * keystroke in an unrelated field would make the whole app feel broken.
 *
 * A corollary the UI depends on: changing the *format* re-renders from the
 * existing model rather than regenerating it. Generation (parse → model) is
 * the expensive half and is independent of format, so switching HTML ↔
 * Markdown is close to free.
 *
 * ## Rendered output is never persisted
 *
 * `documentation` and `rendered` are session-only, deliberately. See
 * `lib/documentationPersistence.ts` and spec §42.
 */

interface InitialDocumentationState {
  documentationWorkspace: DocumentationWorkspace;
  documentationLoadError: string | null;
}

function loadInitial(): InitialDocumentationState {
  const result = loadDocumentationFromStorage();
  return {
    documentationWorkspace:
      result.status === "ok" ? result.data : createEmptyDocumentationWorkspace(),
    documentationLoadError: result.status === "error" ? result.detail : null,
  };
}

/** Everything `generate()` needs that this store deliberately does not own. */
export interface DocumentationGenerationInput {
  specificationSource: string | undefined;
  collection: DocCollectionSource | undefined;
  coverage: CoverageReport | undefined;
  drift: DriftReport | undefined;
}

interface DocumentationState {
  documentationWorkspace: DocumentationWorkspace;
  documentationLoadError: string | null;

  /** The configuration currently being edited in the dialog. */
  config: DocumentationConfig;

  /** The generated model, or null before the first successful generation. */
  documentation: Documentation | null;
  /** The rendered output for `config.format`, or null. */
  rendered: RenderedDocument | null;
  /** Why the last generation attempt failed, if it did. */
  generationError: string | null;

  setSourceKind: (sourceKind: DocSourceKind) => void;
  setSpecification: (specificationId: string | undefined) => void;
  setCollection: (collectionId: string | undefined) => void;
  setFormat: (format: DocFormat) => void;
  setSection: (section: keyof DocSections, enabled: boolean) => void;
  setGrouping: (grouping: DocGroupingMode) => void;
  setIncludeCollectionExamples: (include: boolean) => void;
  setIncludeTimestamp: (include: boolean) => void;

  generate: (input: DocumentationGenerationInput) => void;
  clear: () => void;
  saveConfig: (name: string) => void;
  removeConfig: (configId: string) => void;
  loadConfig: (configId: string) => void;
  resetDocumentation: () => void;
}

export const useDocumentationStore = create<DocumentationState>((set, get) => {
  const initial = loadInitial();

  /**
   * Re-renders the existing model without regenerating it.
   *
   * Used by every setter that affects only presentation — the format and the
   * section toggles. Regenerating for those would re-parse the specification
   * for no reason.
   */
  function rerender(config: DocumentationConfig): Partial<DocumentationState> {
    const documentation = get().documentation;
    if (documentation === null) return { config };
    return {
      config,
      rendered: renderDocumentation(documentation, config.format, {
        sections: config.sections,
        includeSearch: true,
      }),
    };
  }

  /**
   * Applies a change that invalidates the generated model.
   *
   * Source, grouping and example settings all change *what is generated*, not
   * merely how it is displayed, so the previous output is discarded rather
   * than left on screen. Showing documentation generated from a specification
   * the user has since switched away from would be actively misleading — the
   * same rule `useSecurityStore.generate` applies to stale results.
   */
  function invalidate(config: DocumentationConfig): Partial<DocumentationState> {
    return { config, documentation: null, rendered: null, generationError: null };
  }

  return {
    documentationWorkspace: initial.documentationWorkspace,
    documentationLoadError: initial.documentationLoadError,

    config: createDefaultDocumentationConfig(createId("doc"), "API documentation"),

    documentation: null,
    rendered: null,
    generationError: null,

    setSourceKind: (sourceKind) => set((s) => invalidate({ ...s.config, sourceKind })),
    setSpecification: (specificationId) => set((s) => invalidate({ ...s.config, specificationId })),
    setCollection: (collectionId) => set((s) => invalidate({ ...s.config, collectionId })),
    setGrouping: (grouping) => set((s) => invalidate({ ...s.config, grouping })),
    setIncludeCollectionExamples: (includeCollectionExamples) =>
      set((s) => invalidate({ ...s.config, includeCollectionExamples })),
    setIncludeTimestamp: (includeTimestamp) =>
      set((s) => invalidate({ ...s.config, includeTimestamp })),

    // Presentation-only: re-render, do not regenerate.
    setFormat: (format) => set((s) => rerender({ ...s.config, format })),
    setSection: (section, enabled) =>
      set((s) => rerender({ ...s.config, sections: { ...s.config.sections, [section]: enabled } })),

    generate: (input) => {
      const { config } = get();

      const result = generateDocumentation({
        specificationSource: config.sourceKind === "collection" ? undefined : input.specificationSource,
        collection: config.sourceKind === "openapi" ? undefined : input.collection,
        grouping: config.grouping,
        includeCollectionExamples: config.includeCollectionExamples,
        coverage: config.sections.contractStatus ? input.coverage : undefined,
        drift: config.sections.contractStatus ? input.drift : undefined,
        // Opt-in, so output is reproducible by default (spec §33).
        generatedAt: config.includeTimestamp ? new Date().toISOString() : undefined,
      });

      if (!result.ok) {
        set({ documentation: null, rendered: null, generationError: result.detail });
        return;
      }

      set({
        documentation: result.documentation,
        rendered: renderDocumentation(result.documentation, config.format, {
          sections: config.sections,
          includeSearch: true,
        }),
        generationError: null,
      });
    },

    clear: () => set({ documentation: null, rendered: null, generationError: null }),

    saveConfig: (name) => {
      const config = { ...get().config, name: name.trim() === "" ? "Untitled" : name.trim() };
      set((s) => {
        const existing = s.documentationWorkspace.configs.findIndex(
          (candidate) => candidate.id === config.id,
        );
        const configs =
          existing === -1
            ? [...s.documentationWorkspace.configs, config]
            : s.documentationWorkspace.configs.map((candidate, index) =>
                index === existing ? config : candidate,
              );
        return { config, documentationWorkspace: { configs } };
      });
    },

    removeConfig: (configId) =>
      set((s) => ({
        documentationWorkspace: {
          configs: s.documentationWorkspace.configs.filter((config) => config.id !== configId),
        },
      })),

    loadConfig: (configId) => {
      const config = get().documentationWorkspace.configs.find(
        (candidate) => candidate.id === configId,
      );
      if (config === undefined) return;
      // Loading a saved configuration discards the current output for the same
      // reason a source change does — it describes different documentation.
      set(invalidate(config));
    },

    resetDocumentation: () => {
      resetDocumentationStorage();
      set({
        documentationWorkspace: createEmptyDocumentationWorkspace(),
        documentationLoadError: null,
        config: createDefaultDocumentationConfig(createId("doc"), "API documentation"),
        documentation: null,
        rendered: null,
        generationError: null,
      });
    },
  };
});

// Persist (debounced) whenever the saved configurations change, skipping
// writes while a load error is displayed so possibly-recoverable data is never
// clobbered — the same rule every other store in this app applies.
let lastWorkspace = useDocumentationStore.getState().documentationWorkspace;
useDocumentationStore.subscribe((state) => {
  if (state.documentationWorkspace !== lastWorkspace) {
    lastWorkspace = state.documentationWorkspace;
    if (!state.documentationLoadError) {
      saveDocumentationToStorage(state.documentationWorkspace);
    }
  }
});
