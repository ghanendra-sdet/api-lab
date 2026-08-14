import { create } from "zustand";
import {
  createEmptyContractWorkspace,
  detectSourceFormat,
  parseContract,
  parseContractCached,
  type AttachedSpecification,
  type ContractModel,
  type ContractWorkspace,
} from "@api-lab/contract-engine";
import { createId } from "../lib/id";
import {
  loadContractsFromStorage,
  resetContractsStorage,
  saveContractsToStorage,
} from "../lib/contractPersistence";
import { vetSpecificationSource } from "../lib/patternVetting";

/**
 * Attached specifications, their collection bindings, and which operations
 * have been contract-validated this session.
 *
 * A store of its own rather than more fields on `useAppStore`, matching the
 * Milestone 9/10 precedent (`useMockStore`, `usePerfStore`): contract state
 * has its own lifecycle, its own persistence key, and no overlap with tab or
 * workspace state.
 *
 * Contract *models* are never stored here — only the source text is. The
 * model is derived on demand through `parseContractCached`, which keys on
 * the text, so there is no second copy of the parsed document to keep in
 * sync and no invalidation logic to get wrong (spec §42).
 */

interface InitialContractState {
  contracts: ContractWorkspace;
  contractsLoadError: string | null;
}

function loadInitial(): InitialContractState {
  const result = loadContractsFromStorage();
  return {
    contracts: result.status === "ok" ? result.data : createEmptyContractWorkspace(),
    contractsLoadError: result.status === "error" ? result.detail : null,
  };
}

export type ImportSpecResult = { ok: true; id: string } | { ok: false; detail: string };

/**
 * Status of the isolated ReDoS pattern vetting for the specifications
 * currently loaded (Milestone 12, spec §37).
 *
 * Surfaced in the UI rather than kept internal, because "the check was
 * skipped" and "the check passed" must never look the same — the same rule
 * contract-engine applies to its own validation warnings. `degraded` means no
 * Worker was available and only the two static layers are in force.
 */
export interface PatternVettingState {
  status: "idle" | "running" | "done";
  vetted: number;
  timedOut: number;
  unsafe: number;
  degraded: boolean;
}

interface ContractState {
  contracts: ContractWorkspace;
  contractsLoadError: string | null;

  /**
   * Operation ids (`"GET /users/{id}"`) validated at least once this session,
   * keyed by specification id. Deliberately NOT persisted: it describes what
   * happened in this session, and a coverage figure restored from last week
   * would be actively misleading (spec §37).
   */
  validatedOperations: Record<string, string[]>;

  /**
   * The specification the request workspace validates against. A saved
   * request inherits its collection's binding (spec §26); this is the
   * explicit choice for an unsaved request, or an override for a saved one.
   */
  activeSpecificationId: string | null;
  setActiveSpecification: (specId: string | null) => void;

  patternVetting: PatternVettingState;
  /** Executes worker-isolated pattern vetting for one specification's source. */
  vetSpecification: (source: string) => Promise<void>;

  importSpecification: (name: string, source: string) => ImportSpecResult;
  removeSpecification: (specId: string) => void;
  renameSpecification: (specId: string, name: string) => void;
  bindCollection: (specId: string, collectionId: string) => void;
  unbindCollection: (specId: string, collectionId: string) => void;
  recordValidatedOperation: (specId: string, operationId: string) => void;
  resetContracts: () => void;
}

export const useContractStore = create<ContractState>((set, get) => {
  const initial = loadInitial();

  return {
    contracts: initial.contracts,
    contractsLoadError: initial.contractsLoadError,
    validatedOperations: {},

    activeSpecificationId: null,
    setActiveSpecification: (specId) => set({ activeSpecificationId: specId }),

    patternVetting: { status: "idle", vetted: 0, timedOut: 0, unsafe: 0, degraded: false },

    vetSpecification: async (source) => {
      set((s) => ({ patternVetting: { ...s.patternVetting, status: "running" } }));
      const summary = await vetSpecificationSource(source);
      set((s) => ({
        patternVetting: {
          status: "done",
          // Accumulated across specifications: the verdict registry is global,
          // so a per-document counter would understate what is in force.
          vetted: s.patternVetting.vetted + summary.vetted,
          timedOut: s.patternVetting.timedOut + summary.timedOut.length,
          unsafe: s.patternVetting.unsafe + summary.unsafe.length,
          degraded: summary.degraded,
        },
      }));
    },

    importSpecification: (name, source) => {
      // Parsed eagerly so an unusable document is rejected at import time
      // rather than surfacing later as a mysterious validation failure.
      const parsed = parseContract(source);
      if (!parsed.ok) return { ok: false, detail: parsed.detail };

      const specification: AttachedSpecification = {
        id: createId("spec"),
        name: name.trim() === "" ? parsed.contract.title : name.trim(),
        source,
        sourceFormat: detectSourceFormat(source),
        openapiVersionString: parsed.contract.openapiVersionString,
        importedAt: new Date().toISOString(),
        collectionIds: [],
      };

      set((s) => ({
        contracts: { specifications: [...s.contracts.specifications, specification] },
      }));

      // Vetting is asynchronous (it round-trips through a worker) while import
      // is synchronous, so it is started here and awaited by nobody. That is
      // safe because it can only ever *tighten* screening: until it completes,
      // the two static layers are already rejecting patterns, and when it
      // completes it invalidates the parse cache so any newly-vetoed pattern is
      // stripped from the model. See lib/patternVetting.ts.
      void get().vetSpecification(source);

      return { ok: true, id: specification.id };
    },

    removeSpecification: (specId) =>
      set((s) => {
        const validatedOperations = { ...s.validatedOperations };
        delete validatedOperations[specId];
        return {
          contracts: { specifications: s.contracts.specifications.filter((spec) => spec.id !== specId) },
          validatedOperations,
          activeSpecificationId: s.activeSpecificationId === specId ? null : s.activeSpecificationId,
        };
      }),

    renameSpecification: (specId, name) =>
      set((s) => ({
        contracts: {
          specifications: s.contracts.specifications.map((spec) =>
            spec.id === specId ? { ...spec, name } : spec,
          ),
        },
      })),

    bindCollection: (specId, collectionId) =>
      set((s) => ({
        contracts: {
          specifications: s.contracts.specifications.map((spec) => {
            // A collection is bound to at most one specification, so binding
            // it to a new one clears any previous binding rather than leaving
            // an ambiguous two-contract collection behind.
            if (spec.id === specId) {
              return spec.collectionIds.includes(collectionId)
                ? spec
                : { ...spec, collectionIds: [...spec.collectionIds, collectionId] };
            }
            return spec.collectionIds.includes(collectionId)
              ? { ...spec, collectionIds: spec.collectionIds.filter((id) => id !== collectionId) }
              : spec;
          }),
        },
      })),

    unbindCollection: (specId, collectionId) =>
      set((s) => ({
        contracts: {
          specifications: s.contracts.specifications.map((spec) =>
            spec.id === specId
              ? { ...spec, collectionIds: spec.collectionIds.filter((id) => id !== collectionId) }
              : spec,
          ),
        },
      })),

    recordValidatedOperation: (specId, operationId) => {
      const existing = get().validatedOperations[specId] ?? [];
      if (existing.includes(operationId)) return;
      set((s) => ({
        validatedOperations: { ...s.validatedOperations, [specId]: [...existing, operationId] },
      }));
    },

    resetContracts: () => {
      resetContractsStorage();
      set({
        contracts: createEmptyContractWorkspace(),
        contractsLoadError: null,
        validatedOperations: {},
        activeSpecificationId: null,
      });
    },
  };
});

/** Derives (and caches) the contract model for an attached specification. */
export function getContractModel(specification: AttachedSpecification | undefined): ContractModel | null {
  if (!specification) return null;
  const parsed = parseContractCached(specification.source);
  return parsed.ok ? parsed.contract : null;
}

/** The specification bound to a collection, if any (spec §26). */
export function findSpecificationForCollection(
  contracts: ContractWorkspace,
  collectionId: string | undefined,
): AttachedSpecification | undefined {
  if (collectionId === undefined) return undefined;
  return contracts.specifications.find((spec) => spec.collectionIds.includes(collectionId));
}

// Specifications restored from storage are vetted too. localStorage is as
// untrusted as a file — a hostile pattern persisted in a previous session
// must not get a free pass just because it is no longer arriving through the
// import path.
for (const restored of useContractStore.getState().contracts.specifications) {
  void useContractStore.getState().vetSpecification(restored.source);
}

// Persist (debounced) whenever the attached specifications change, skipping
// writes while a load error is displayed so possibly-recoverable data is
// never clobbered — the same rule useAppStore applies to the workspace.
let lastContracts = useContractStore.getState().contracts;
useContractStore.subscribe((state) => {
  if (state.contracts !== lastContracts) {
    lastContracts = state.contracts;
    if (!state.contractsLoadError) {
      saveContractsToStorage(state.contracts);
    }
  }
});
