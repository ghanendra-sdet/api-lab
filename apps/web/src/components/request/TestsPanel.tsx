import { ASSERTION_TARGETS, OPERATORS_BY_TARGET, type Assertion, type AssertionTarget } from "@api-lab/test-engine";
import { EXTRACTION_SOURCES, type ExtractionSource } from "@api-lab/runner-engine";
import { useAppStore } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";

const EXTRACTION_SOURCE_LABELS: Record<ExtractionSource, string> = {
  json: "JSON Path",
  header: "Header",
};

const TARGET_LABELS: Record<AssertionTarget, string> = {
  status: "Status",
  statusRange: "Status Range",
  header: "Header",
  body: "Body",
  json: "JSON Path",
  responseTime: "Response Time",
  responseSize: "Response Size",
};

const OPERATOR_LABELS: Record<string, string> = {
  equals: "equals",
  notEquals: "not equals",
  contains: "contains",
  notContains: "does not contain",
  exists: "exists",
  notExists: "does not exist",
  greaterThan: "greater than",
  lessThan: "less than",
  greaterThanOrEqual: "greater than or equal to",
  lessThanOrEqual: "less than or equal to",
  matches: "matches (regex)",
};

function needsKey(target: AssertionTarget): boolean {
  return target === "header" || target === "json";
}

function needsExpected(operator: string): boolean {
  return operator !== "exists" && operator !== "notExists";
}

export function TestsPanel({ tab }: { tab: RequestTabState }) {
  const addAssertion = useAppStore((s) => s.addAssertion);
  const updateAssertion = useAppStore((s) => s.updateAssertion);
  const removeAssertion = useAppStore((s) => s.removeAssertion);
  const addExtraction = useAppStore((s) => s.addExtraction);
  const updateExtraction = useAppStore((s) => s.updateExtraction);
  const removeExtraction = useAppStore((s) => s.removeExtraction);
  const testResult = useAppStore((s) => s.testResults[tab.id]);
  const extractionResults = useAppStore((s) => s.extractionResults[tab.id]);

  function handleTargetChange(assertion: Assertion, target: AssertionTarget) {
    const operator = OPERATORS_BY_TARGET[target][0]!;
    updateAssertion(tab.id, assertion.id, {
      target,
      operator,
      key: needsKey(target) ? (assertion.key ?? "") : undefined,
      expected: target === "statusRange" ? "2xx" : assertion.expected,
    });
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Assertions</caption>
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <th scope="col" className="w-8 py-1.5 pr-2 font-medium"></th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Target</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Operator</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Key</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Expected</th>
              <th scope="col" className="w-8 py-1.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {tab.tests.map((assertion) => (
              <tr key={assertion.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1 pr-2">
                  <input
                    type="checkbox"
                    checked={assertion.enabled}
                    onChange={(e) => updateAssertion(tab.id, assertion.id, { enabled: e.target.checked })}
                    aria-label="Enable assertion"
                    className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-neutral-700"
                  />
                </td>
                <td className="py-1 pr-2">
                  <label className="sr-only" htmlFor={`target-${assertion.id}`}>Target</label>
                  <select
                    id={`target-${assertion.id}`}
                    value={assertion.target}
                    onChange={(e) => handleTargetChange(assertion, e.target.value as AssertionTarget)}
                    className="w-full rounded border border-neutral-200 bg-white px-1.5 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    {ASSERTION_TARGETS.map((target) => (
                      <option key={target} value={target}>
                        {TARGET_LABELS[target]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <label className="sr-only" htmlFor={`operator-${assertion.id}`}>Operator</label>
                  <select
                    id={`operator-${assertion.id}`}
                    value={assertion.operator}
                    onChange={(e) => updateAssertion(tab.id, assertion.id, { operator: e.target.value as Assertion["operator"] })}
                    className="w-full rounded border border-neutral-200 bg-white px-1.5 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    {OPERATORS_BY_TARGET[assertion.target].map((op) => (
                      <option key={op} value={op}>
                        {OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  {needsKey(assertion.target) ? (
                    <>
                      <label className="sr-only" htmlFor={`key-${assertion.id}`}>
                        {assertion.target === "header" ? "Header name" : "JSON path"}
                      </label>
                      <input
                        id={`key-${assertion.id}`}
                        type="text"
                        value={assertion.key ?? ""}
                        onChange={(e) => updateAssertion(tab.id, assertion.id, { key: e.target.value })}
                        placeholder={assertion.target === "header" ? "content-type" : "$.id"}
                        spellCheck={false}
                        className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 font-mono text-sm hover:border-neutral-200 focus-visible:border-transparent dark:hover:border-neutral-800"
                      />
                    </>
                  ) : (
                    <span className="px-1.5 text-neutral-300 dark:text-neutral-700">—</span>
                  )}
                </td>
                <td className="py-1 pr-2">
                  {needsExpected(assertion.operator) ? (
                    <>
                      <label className="sr-only" htmlFor={`expected-${assertion.id}`}>Expected</label>
                      <input
                        id={`expected-${assertion.id}`}
                        type="text"
                        value={assertion.expected}
                        onChange={(e) => updateAssertion(tab.id, assertion.id, { expected: e.target.value })}
                        placeholder={assertion.target === "statusRange" ? "2xx" : "expected value"}
                        spellCheck={false}
                        className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 font-mono text-sm hover:border-neutral-200 focus-visible:border-transparent dark:hover:border-neutral-800"
                      />
                    </>
                  ) : (
                    <span className="px-1.5 text-neutral-300 dark:text-neutral-700">—</span>
                  )}
                </td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => removeAssertion(tab.id, assertion.id)}
                    aria-label="Delete assertion"
                    className="rounded px-1.5 py-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={() => addAssertion(tab.id)}
          className="mt-2 rounded px-2 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
        >
          + Add Assertion
        </button>
      </div>

      <div className="mt-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Extract Variables
        </p>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Extractions</caption>
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <th scope="col" className="w-8 py-1.5 pr-2 font-medium"></th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Source</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Path / Header</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Variable</th>
              <th scope="col" className="w-8 py-1.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {tab.extractions.map((extraction) => (
              <tr key={extraction.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1 pr-2">
                  <input
                    type="checkbox"
                    checked={extraction.enabled}
                    onChange={(e) => updateExtraction(tab.id, extraction.id, { enabled: e.target.checked })}
                    aria-label="Enable extraction"
                    className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-neutral-700"
                  />
                </td>
                <td className="py-1 pr-2">
                  <label className="sr-only" htmlFor={`extraction-source-${extraction.id}`}>Source</label>
                  <select
                    id={`extraction-source-${extraction.id}`}
                    value={extraction.source}
                    onChange={(e) => updateExtraction(tab.id, extraction.id, { source: e.target.value as ExtractionSource })}
                    className="w-full rounded border border-neutral-200 bg-white px-1.5 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    {EXTRACTION_SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {EXTRACTION_SOURCE_LABELS[source]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <label className="sr-only" htmlFor={`extraction-path-${extraction.id}`}>
                    {extraction.source === "header" ? "Header name" : "JSON path"}
                  </label>
                  <input
                    id={`extraction-path-${extraction.id}`}
                    type="text"
                    value={extraction.path}
                    onChange={(e) => updateExtraction(tab.id, extraction.id, { path: e.target.value })}
                    placeholder={extraction.source === "header" ? "Authorization" : "$.token"}
                    spellCheck={false}
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 font-mono text-sm hover:border-neutral-200 focus-visible:border-transparent dark:hover:border-neutral-800"
                  />
                </td>
                <td className="py-1 pr-2">
                  <label className="sr-only" htmlFor={`extraction-variable-${extraction.id}`}>Variable name</label>
                  <input
                    id={`extraction-variable-${extraction.id}`}
                    type="text"
                    value={extraction.variable}
                    onChange={(e) => updateExtraction(tab.id, extraction.id, { variable: e.target.value })}
                    placeholder="authToken"
                    spellCheck={false}
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 font-mono text-sm hover:border-neutral-200 focus-visible:border-transparent dark:hover:border-neutral-800"
                  />
                </td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => removeExtraction(tab.id, extraction.id)}
                    aria-label="Delete extraction"
                    className="rounded px-1.5 py-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={() => addExtraction(tab.id)}
          className="mt-2 rounded px-2 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
        >
          + Add Extraction
        </button>
        {extractionResults && extractionResults.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {extractionResults.map((result) => (
              <li
                key={result.extraction.id}
                className={result.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}
              >
                <span aria-hidden="true">{result.ok ? "✓" : "✗"}</span> {result.extraction.variable}
                {result.ok ? ` = ${result.value}` : ` — ${result.error}`}
              </li>
            ))}
          </ul>
        )}
      </div>

      {testResult && (
        <div className="mt-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <p className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">
            {testResult.assertions.filter((a) => a.passed).length} passed · {testResult.assertions.filter((a) => !a.passed).length} failed
          </p>
          <ul className="space-y-1 text-sm">
            {testResult.assertions.map((result, i) => (
              <li
                key={i}
                className={result.passed ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}
              >
                <span aria-hidden="true">{result.passed ? "✓" : "✗"}</span> {result.message}
                {result.error && <span className="ml-1 text-neutral-500 dark:text-neutral-400">({result.error})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
