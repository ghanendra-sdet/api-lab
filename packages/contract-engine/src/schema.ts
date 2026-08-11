import { z } from "zod";
import { MAX_SPEC_FILE_SIZE_BYTES } from "./limits.ts";
import {
  CONTRACT_FORMAT_VERSION,
  type ContractWorkspace,
  type PersistedContractWorkspace,
} from "./types.ts";

/**
 * Persistence for attached specifications (spec §26).
 *
 * Follows the same versioned `{version, ...}` envelope every persisted format
 * in this repo uses (workspace, environments, mock routes, performance
 * config): validated with Zod on load, never trusted, and recovered from
 * rather than crashed on.
 *
 * The source text is length-capped on load as well as on import. Data in
 * localStorage is as untrusted as data from a file — any script with access
 * to the origin could have written it — so the limit that protects the
 * import path has to protect the load path too.
 */

export const attachedSpecificationSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string().max(MAX_SPEC_FILE_SIZE_BYTES),
  sourceFormat: z.enum(["json", "yaml"]),
  openapiVersionString: z.string(),
  importedAt: z.string(),
  collectionIds: z.array(z.string()),
});

export const contractWorkspaceSchema: z.ZodType<ContractWorkspace> = z.object({
  specifications: z.array(attachedSpecificationSchema),
});

export function serializeContracts(contracts: ContractWorkspace): PersistedContractWorkspace {
  return { version: CONTRACT_FORMAT_VERSION, contracts };
}

export type DeserializeContractsResult =
  | { ok: true; contracts: ContractWorkspace }
  | { ok: false; reason: "invalid-envelope" | "unsupported-version" | "invalid-shape"; detail: string };

export function deserializeContracts(raw: unknown): DeserializeContractsResult {
  if (typeof raw !== "object" || raw === null || !("version" in raw) || !("contracts" in raw)) {
    return { ok: false, reason: "invalid-envelope", detail: "Missing version or contracts field." };
  }

  const { version, contracts } = raw as { version: unknown; contracts: unknown };

  if (typeof version !== "number") {
    return { ok: false, reason: "invalid-envelope", detail: "version must be a number." };
  }
  if (version !== CONTRACT_FORMAT_VERSION) {
    return {
      ok: false,
      reason: "unsupported-version",
      detail: `Unsupported contract format version: ${version}.`,
    };
  }

  const parsed = contractWorkspaceSchema.safeParse(contracts);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-shape", detail: parsed.error.message };
  }

  return { ok: true, contracts: parsed.data };
}

export function createEmptyContractWorkspace(): ContractWorkspace {
  return { specifications: [] };
}
