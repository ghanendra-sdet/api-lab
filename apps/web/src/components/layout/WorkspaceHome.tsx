import { useAppStore } from "../../store/useAppStore";

const CAPABILITIES = [
  { title: "Collections & Environments", body: "Build requests, organize them into folders, and switch context with environment variables." },
  { title: "Authentication", body: "API Key, Basic, Bearer, and JWT auth, resolved from environment variables at send time." },
  { title: "Assertions & Runner", body: "Attach assertions to a request and run whole collections with datasets, chaining, and iterations." },
  { title: "Mock Server", body: "A real local server for configurable routes, scenarios, and deterministic responses. See the Mock Server button above." },
  { title: "Performance Testing", body: "Load-test a request or collection with virtual users, ramp-up, and live metrics." },
  { title: "Contract Testing", body: "Validate real requests and responses against an OpenAPI 3.0/3.1 contract, with drift and coverage reporting." },
  { title: "Security & Negative Testing", body: "Generate bounded negative tests from a contract and check for common security misconfigurations." },
];

export function WorkspaceHome() {
  const setActiveView = useAppStore((s) => s.setActiveView);

  return (
    <main className="flex min-w-0 flex-1 overflow-y-auto" aria-label="API Lab home">
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <div className="mb-8 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-lg font-bold text-white"
          >
            A
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">API Lab</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              A free, browser-based API client, testing, mocking, performance, and contract-testing workspace.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setActiveView("request")}
          className="mb-10 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Go to Workspace →
        </button>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          What's built so far
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <li
              key={c.title}
              className="rounded border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <div className="text-sm font-medium">{c.title}</div>
              <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{c.body}</div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
