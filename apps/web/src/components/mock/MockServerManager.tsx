import { useEffect, useState } from "react";
import { useMockStore } from "../../store/useMockStore";
import { RouteEditor } from "./RouteEditor";

interface MockServerManagerProps {
  onClose: () => void;
}

type Tab = "routes" | "logs";

export function MockServerManager({ onClose }: MockServerManagerProps) {
  const baseUrl = useMockStore((s) => s.baseUrl);
  const setBaseUrl = useMockStore((s) => s.setBaseUrl);
  const status = useMockStore((s) => s.status);
  const routes = useMockStore((s) => s.routes);
  const logs = useMockStore((s) => s.logs);
  const error = useMockStore((s) => s.error);
  const refresh = useMockStore((s) => s.refresh);
  const start = useMockStore((s) => s.start);
  const stop = useMockStore((s) => s.stop);
  const createRoute = useMockStore((s) => s.createRoute);
  const deleteRoute = useMockStore((s) => s.deleteRoute);

  const [tab, setTab] = useState<Tab>("routes");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState(baseUrl);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  useEffect(() => {
    if (selectedId && !routes.some((r) => r.id === selectedId)) {
      setSelectedId(routes[0]?.id ?? null);
    }
  }, [routes, selectedId]);

  const selectedRoute = routes.find((r) => r.id === selectedId) ?? null;

  async function handleNewRoute() {
    await createRoute({ method: "GET", path: "/new-route" });
    const latest = useMockStore.getState().routes;
    const created = [...latest].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (created) setSelectedId(created.id);
  }

  function handleConnect() {
    setBaseUrl(urlDraft.trim() || "http://localhost:4010");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button type="button" aria-label="Close dialog" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mock Server"
        className="relative flex h-[36rem] w-[52rem] max-w-[95vw] flex-col rounded-md bg-white shadow-lg dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Mock Server</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close mock server manager"
            className="rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800">
          <label htmlFor="mock-server-url" className="sr-only">
            Mock server URL
          </label>
          <input
            id="mock-server-url"
            type="text"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={handleConnect}
            className="w-56 rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
          />
          {status ? (
            <>
              <span className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${status.running ? "bg-green-500" : "bg-neutral-400"}`}
                />
                Status: {status.running ? "Running" : "Stopped"}
              </span>
              <span>Port: {status.port ?? "—"}</span>
              <span>Routes: {status.routes}</span>
            </>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">{error ?? "Connecting…"}</span>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => void start()}
              disabled={!!status?.running}
              className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Start
            </button>
            <button
              type="button"
              onClick={() => void stop()}
              disabled={!status?.running}
              className="rounded bg-neutral-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-neutral-200 px-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setTab("routes")}
            className={`px-2 py-2 text-sm ${tab === "routes" ? "border-b-2 border-blue-600 font-medium text-blue-600" : "text-neutral-500"}`}
          >
            Routes
          </button>
          <button
            type="button"
            onClick={() => setTab("logs")}
            className={`px-2 py-2 text-sm ${tab === "logs" ? "border-b-2 border-blue-600 font-medium text-blue-600" : "text-neutral-500"}`}
          >
            Requests
          </button>
        </div>

        {tab === "routes" ? (
          <div className="flex min-h-0 flex-1">
            <div className="w-56 shrink-0 overflow-y-auto border-r border-neutral-200 p-2 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => void handleNewRoute()}
                className="mb-2 w-full rounded px-2 py-1.5 text-left text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
              >
                + New Route
              </button>
              <ul className="space-y-0.5">
                {routes.map((r) => (
                  <li key={r.id} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      className={`flex-1 truncate rounded px-2 py-1.5 text-left text-sm ${
                        r.id === selectedId ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                      } ${!r.enabled ? "opacity-50" : ""}`}
                    >
                      <span className="font-mono text-xs text-neutral-500">{r.method}</span> {r.path}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteRoute(r.id)}
                      aria-label={`Delete route ${r.method} ${r.path}`}
                      className="rounded px-1.5 py-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              {routes.length === 0 && <p className="px-2 text-xs text-neutral-400">No routes yet.</p>}
            </div>
            <div className="min-w-0 flex-1">
              {selectedRoute ? (
                <RouteEditor key={selectedRoute.id} route={selectedRoute} />
              ) : (
                <p className="p-4 text-sm text-neutral-400">Select or create a route to configure it.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2">
            {logs.length === 0 ? (
              <p className="p-2 text-sm text-neutral-400">No requests logged yet.</p>
            ) : (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 text-left uppercase text-neutral-500 dark:border-neutral-800">
                    <th className="py-1 pr-2 font-medium">Time</th>
                    <th className="py-1 pr-2 font-medium">Method</th>
                    <th className="py-1 pr-2 font-medium">Path</th>
                    <th className="py-1 pr-2 font-medium">Status</th>
                    <th className="py-1 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((entry) => (
                    <tr key={entry.id} className="border-b border-neutral-100 dark:border-neutral-900">
                      <td className="py-1 pr-2 font-mono">{new Date(entry.timestamp).toLocaleTimeString()}</td>
                      <td className="py-1 pr-2 font-mono">{entry.method}</td>
                      <td className="py-1 pr-2 font-mono">{entry.path}</td>
                      <td className={`py-1 pr-2 font-mono ${entry.matched ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                        {entry.status}
                      </td>
                      <td className="py-1 font-mono">{entry.durationMs}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
