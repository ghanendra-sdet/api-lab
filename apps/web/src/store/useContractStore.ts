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
