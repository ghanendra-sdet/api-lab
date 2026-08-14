import { create } from "zustand";
import {
  createDefaultGeneratorCategories,
  createDefaultGenerationExpectations,
  createEmptySecurityWorkspace,
  generateNegativeTests,
  runSecurityTests,
  type GenerationExpectations,
  type GenerationTarget,
  type GeneratorCategories,
  type SecurityExecutor,
  type SecurityRequestInput,
  type SecurityRunStatus,
  type SecurityTestResult,
  type SecurityWorkspace,
} from "@api-lab/security-engine";
import {
  loadSecurityFromStorage,
  resetSecurityStorage,
  saveSecurityToStorage,
} from "../lib/securityPersistence";

/**
 * Generated negative tests, the generator's settings, and the current run.
 *
 * A store of its own rather than more fields on `useAppStore`, matching the
 * Milestone 9/10/11 precedent (`useMockStore`, `usePerfStore`,
 * `useContractStore`): security state has its own lifecycle, its own
 * persistence key, and no overlap with tab or workspace state.
 *
 * It also takes no dependency on `useAppStore`. Generation and execution
 * receive their targets and a `resolveRequest` callback from the caller, so
 * this store never reaches into collections or environments itself. That
 * keeps the credential-resolution boundary sharp: the store holds
 * definitions, the caller supplies live values at execution time, and the two
 * never mix (spec §33).
 *
 * ## Results are not persisted
 *
 * `results` lives here only for the session. See lib/securityPersistence.ts
 * for why (spec §40).
 */

interface InitialSecurityState {
  security: SecurityWorkspace;
  securityLoadError: string | null;
}

function loadInitial(): InitialSecurityState {
  const result = loadSecurityFromStorage();
  return {
    security: result.status === "ok" ? result.data : createEmptySecurityWorkspace(),
    securityLoadError: result.status === "error" ? result.detail : null,
  };
}

export interface SecurityRunProgress {
  completed: number;
  total: number;
}

interface SecurityState {
  security: SecurityWorkspace;
  securityLoadError: string | null;

  categories: GeneratorCategories;
  expectations: GenerationExpectations;

  /** Why generation produced fewer (or different) tests than expected. */
  generationWarnings: string[];
  truncated: boolean;
  /** Set once a generation pass has run, so the preview can distinguish
   * "nothing generated yet" from "generated nothing" (spec §28). */
  hasGenerated: boolean;

  runStatus: SecurityRunStatus;
  results: SecurityTestResult[];
  progress: SecurityRunProgress;
  /** Set when a run was refused before sending anything (spec §29, §30). */
  refusedReason: string | null;
  /** Hosts the user explicitly approved in the confirmation dialog. */
  confirmedHosts: string[];

  setCategories: (patch: Partial<GeneratorCategories>) => void;
  setExpectations: (patch: Partial<GenerationExpectations>) => void;
  generate: (targets: GenerationTarget[]) => void;
  setTestEnabled: (testId: string, enabled: boolean) => void;
  setAllTestsEnabled: (enabled: boolean) => void;
  clearTests: () => void;
  confirmHost: (host: string) => void;
  run: (input: {
    resolveRequest: (requestId: string) => SecurityRequestInput | null;
    executor: SecurityExecutor;
  }) => Promise<void>;
  cancelRun: () => void;
  resetSecurity: () => void;
}

/** The live run's abort controller. Module-scoped rather than in the store
 * because it is not renderable state and putting it there would make every
 * subscriber re-render when a run starts. Same choice the Runner made. */
let activeController: AbortController | null = null;

export const useSecurityStore = create<SecurityState>((set, get) => {
  const initial = loadInitial();

  return {
    security: initial.security,
    securityLoadError: initial.securityLoadError,

    categories: createDefaultGeneratorCategories(),
    expectations: createDefaultGenerationExpectations(),

    generationWarnings: [],
    truncated: false,
    hasGenerated: false,

    runStatus: "idle",
    results: [],
    progress: { completed: 0, total: 0 },
    refusedReason: null,
    confirmedHosts: [],

    setCategories: (patch) => set((s) => ({ categories: { ...s.categories, ...patch } })),
    setExpectations: (patch) => set((s) => ({ expectations: { ...s.expectations, ...patch } })),

    generate: (targets) => {
      const { categories, expectations } = get();
      const result = generateNegativeTests({ targets, categories, expectations });

      // Generation replaces the previous suite rather than appending. Appending
      // would make repeated clicks silently accumulate duplicates toward the
      // 100-test limit, and the preview the user approves must correspond
      // exactly to the settings currently on screen.
      set({
        security: { tests: result.tests },
        generationWarnings: result.warnings,
        truncated: result.truncated,
        hasGenerated: true,
        // A new suite invalidates the previous run's results — showing results
        // from tests that no longer exist would be actively misleading.
        results: [],
        runStatus: "idle",
        progress: { completed: 0, total: 0 },
        refusedReason: null,
      });
    },

    setTestEnabled: (testId, enabled) =>
      set((s) => ({
        security: { tests: s.security.tests.map((test) => (test.id === testId ? { ...test, enabled } : test)) },
      })),

    setAllTestsEnabled: (enabled) =>
      set((s) => ({ security: { tests: s.security.tests.map((test) => ({ ...test, enabled })) } })),

    clearTests: () =>
      set({
        security: createEmptySecurityWorkspace(),
        generationWarnings: [],
        truncated: false,
        hasGenerated: false,
        results: [],
        runStatus: "idle",
        progress: { completed: 0, total: 0 },
        refusedReason: null,
      }),

    confirmHost: (host) =>
      set((s) => (s.confirmedHosts.includes(host) ? s : { confirmedHosts: [...s.confirmedHosts, host] })),

    run: async ({ resolveRequest, executor }) => {
      const { security, confirmedHosts } = get();

      activeController = new AbortController();
      set({ runStatus: "running", results: [], refusedReason: null, progress: { completed: 0, total: security.tests.filter((test) => test.enabled).length } });

      const outcome = await runSecurityTests({
        tests: security.tests,
        resolveRequest,
        executor,
        confirmedHosts,
        signal: activeController.signal,
        onProgress: (result, completed, total) => {
          // Results stream in so a hundred-test run is not a blank screen for
          // its whole duration.
          set((s) => ({ results: [...s.results, result], progress: { completed, total } }));
        },
      });

      activeController = null;

      set({
        runStatus: outcome.status,
        // The streamed results are authoritative; `outcome.results` is the
        // same list and is used only when the run was refused outright.
        results: outcome.results.length > 0 ? outcome.results : get().results,
        refusedReason: outcome.refusedReason ?? null,
      });
    },

    cancelRun: () => {
      activeController?.abort();
    },

    resetSecurity: () => {
      resetSecurityStorage();
      set({
        security: createEmptySecurityWorkspace(),
        securityLoadError: null,
        categories: createDefaultGeneratorCategories(),
        expectations: createDefaultGenerationExpectations(),
        generationWarnings: [],
        truncated: false,
        hasGenerated: false,
        runStatus: "idle",
        results: [],
        progress: { completed: 0, total: 0 },
        refusedReason: null,
        confirmedHosts: [],
      });
    },
  };
});

// Persist (debounced) whenever the test definitions change, skipping writes
// while a load error is displayed so possibly-recoverable data is never
// clobbered — the same rule useAppStore and useContractStore apply.
let lastSecurity = useSecurityStore.getState().security;
useSecurityStore.subscribe((state) => {
  if (state.security !== lastSecurity) {
    lastSecurity = state.security;
    if (!state.securityLoadError) {
      saveSecurityToStorage(state.security);
    }
  }
});
