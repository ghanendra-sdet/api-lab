import { useMemo } from "react";
import { resolveOperationForRequest } from "@api-lab/contract-engine";
import { buildDisplayVariableContext, resolveVariables } from "@api-lab/environment-engine";
import { useActiveEnvironment, useAppStore } from "../../store/useAppStore";
import {
  findSpecificationForCollection,
  getContractModel,
  useContractStore,
} from "../../store/useContractStore";
import type { RequestTabState } from "../../types";
import { ContractViolationList } from "./ContractViolationList";

/**
 * The per-request Contract tab (spec §24).
 *
 * Shows, in order: which specification applies and why, which operation this
 * request maps to, and the request/response contract checklists from the
 * last validated send. Kept deliberately plain — the milestone asks for a
 * simple UI, and a contract result is dense enough without decoration.
 */
export function ContractPanel({ tab }: { tab: RequestTabState }) {
  const contracts = useContractStore((s) => s.contracts);
  const activeSpecificationId = useContractStore((s) => s.activeSpecificationId);
  const setActiveSpecification = useContractStore((s) => s.setActiveSpecification);
  const contractResult = useAppStore((s) => s.contractResults[tab.id]);
  const contractValidationEnabled = useAppStore((s) => s.contractValidationEnabled);
  const contractRequestValidationEnabled = useAppStore((s) => s.contractRequestValidationEnabled);
  const setContractRequestValidationEnabled = useAppStore((s) => s.setContractRequestValidationEnabled);
  const activeEnvironment = useActiveEnvironment();

  // A saved request inherits its collection's binding; anything else uses the
  // explicit selection (spec §26).
  const boundSpecification = findSpecificationForCollection(contracts, tab.savedLocation?.collectionId);
  const selectedSpecification =
    boundSpecification ?? contracts.specifications.find((spec) => spec.id === activeSpecificationId);

  const contract = useMemo(() => getContractModel(selectedSpecification), [selectedSpecification]);

  // Variables must be resolved before the URL is matched against the
  // contract — `/users/{{userId}}` is not a path the specification documents.
  const resolvedUrl = useMemo(
    () => resolveVariables(tab.url, buildDisplayVariableContext(activeEnvironment)).value,
    [tab.url, activeEnvironment],
  );

  const resolution = useMemo(
    () => (contract ? resolveOperationForRequest(contract, tab.method, resolvedUrl) : null),
    [contract, tab.method, resolvedUrl],
  );

  return (
    <section aria-label="Contract" className="p-4 text-sm">
      <div className="mb-4">
        <label
          htmlFor="contract-spec-select"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
        >
          Specification
        </label>
        {boundSpecification ? (
          <p className="text-neutral-700 dark:text-neutral-300">
            {boundSpecification.name}{" "}
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              (OpenAPI {boundSpecification.openapiVersionString} — bound to this request&apos;s collection)
            </span>
          </p>
        ) : (
          <select
            id="contract-spec-select"
            value={activeSpecificationId ?? ""}
            onChange={(event) => setActiveSpecification(event.target.value === "" ? null : event.target.value)}
            className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">No specification</option>
            {contracts.specifications.map((spec) => (
              <option key={spec.id} value={spec.id}>
                {spec.name} (OpenAPI {spec.openapiVersionString})
              </option>
            ))}
          </select>
        )}
      </div>

      {contracts.specifications.length === 0 && (
        <p className="rounded border border-neutral-200 p-3 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          No OpenAPI specification is attached yet. Open <strong>Contract</strong> in the top bar to import one.
        </p>
      )}

      {selectedSpecification && !contract && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          This specification could not be parsed, so no contract validation is possible.
        </p>
      )}

      {contract && resolution && (
        <div className="mb-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Resolved operation
          </p>
          {resolution.match.status === "matched" ? (
            <p data-testid="contract-operation" className="font-mono text-neutral-800 dark:text-neutral-100">
              {resolution.match.operation.method} {resolution.match.operation.path}
              {resolution.match.operation.operationId && (
                <span className="ml-2 font-sans text-xs text-neutral-500 dark:text-neutral-400">
                  ({resolution.match.operation.operationId})
                </span>
              )}
            </p>
          ) : (
            <p
              data-testid="contract-operation"
              role="alert"
              className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
            >
              {resolution.match.detail}
            </p>
          )}
          <p className="mt-1 font-mono text-xs text-neutral-500 dark:text-neutral-400">
            Request path: {resolution.path}
          </p>
        </div>
      )}

      {/* Pre-send request validation (spec §7, §12). It lives here rather
          than next to Send because, unlike response validation, enabling it
          can *stop* a request from being sent — a consequence that deserves
          the explanation there is room for on this panel. */}
      {contract && (
        <label className="mb-3 flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={contractRequestValidationEnabled}
            onChange={(event) => setContractRequestValidationEnabled(event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-neutral-300 text-blue-600 dark:border-neutral-700"
          />
          <span>
            Validate request before sending
            <span className="block text-neutral-500 dark:text-neutral-400">
              A request that violates the contract is reported and not sent.
            </span>
          </span>
        </label>
      )}

      {contract && !contractValidationEnabled && (
        <p className="mb-3 rounded border border-neutral-200 p-2 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          Enable <strong>Validate against contract</strong> next to Send to check responses against this
          specification.
        </p>
      )}

      {contractResult && (
        <div>
          <p
            data-testid="contract-verdict"
            className={`mb-2 font-semibold ${
              contractResult.valid
                ? "text-green-700 dark:text-green-400"
                : "text-red-700 dark:text-red-400"
            }`}
          >
            <span aria-hidden="true">{contractResult.valid ? "✓" : "✗"}</span>{" "}
            {contractResult.valid ? "Contract PASS" : "Contract FAIL"}
            <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
              validated in {contractResult.durationMs.toFixed(1)}ms
            </span>
          </p>

          {contractResult.valid && contractResult.warnings.length === 0 && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Request and response both conform to the contract.
            </p>
          )}

          <ContractViolationList violations={contractResult.requestViolations} label="Request contract" />
          <ContractViolationList violations={contractResult.responseViolations} label="Response contract" />
          <ContractViolationList violations={contractResult.warnings} label="Warnings" />
        </div>
      )}
    </section>
  );
}
