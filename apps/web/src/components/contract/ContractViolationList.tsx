import type { ContractViolation } from "@api-lab/contract-engine";

/**
 * Renders contract violations with the four things a QA engineer needs to
 * act on them: where it happened, the JSON path, what the contract expected,
 * and what actually arrived (spec §22, §24).
 *
 * Warnings are styled distinctly from errors and are never hidden behind a
 * passing result — spec §23 is explicit that unsupported validation must not
 * disappear into a green PASS.
 */
export function ContractViolationList({
  violations,
  label,
}: {
  violations: ContractViolation[];
  label: string;
}) {
  if (violations.length === 0) return null;

  return (
    <div className="mt-2">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label} ({violations.length})
      </p>
      <ul className="space-y-1">
        {violations.map((violation, index) => {
          const isError = violation.severity === "error";
          return (
            <li
              key={`${violation.path}-${violation.keyword}-${index}`}
              data-testid="contract-violation"
              className={`rounded border p-2 text-xs ${
                isError
                  ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                  : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
              }`}
            >
              <p className="font-medium">
                <span aria-hidden="true">{isError ? "✗" : "!"}</span> {violation.message}
              </p>
              <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-2 font-mono text-[11px] opacity-90">
                <dt>Location</dt>
                <dd>{violation.location}</dd>
                <dt>Path</dt>
                <dd>{violation.path}</dd>
                <dt>Expected</dt>
                <dd>{violation.expected}</dd>
                <dt>Actual</dt>
                <dd>{violation.actual}</dd>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
