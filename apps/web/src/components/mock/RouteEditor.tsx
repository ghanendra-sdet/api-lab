import { useEffect, useState } from "react";
import { HTTP_METHODS, type HttpMethod } from "@api-lab/shared";
import { STATUS_PRESETS, createScenarioFromPreset, MAX_DELAY_MS, type MockRoute, type MockScenario } from "@api-lab/mock-engine";
import { useMockStore } from "../../store/useMockStore";

interface RouteEditorProps {
  route: MockRoute;
}

/** Editing is local/draft until "Save" — avoids firing a PUT request (and
 * the resulting list refresh re-render) on every keystroke, matching the
 * spec's own mockup (§21), which shows an explicit Save action. */
export function RouteEditor({ route }: RouteEditorProps) {
  const updateRoute = useMockStore((s) => s.updateRoute);

  const [method, setMethod] = useState<HttpMethod>(route.method);
  const [path, setPath] = useState(route.path);
  const [enabled, setEnabled] = useState(route.enabled);
  const [scenarios, setScenarios] = useState<MockScenario[]>(route.scenarios);
  const [activeScenarioId, setActiveScenarioId] = useState(route.activeScenarioId);
  // Which scenario's fields are shown below — independent of which one is
  // live. Adding a new scenario lets you configure it before ever
  // switching the route to serve it (§21); switching the live scenario
  // (§22) is a separate, explicit action next to the selector.
  const [editingScenarioId, setEditingScenarioId] = useState(route.activeScenarioId);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setMethod(route.method);
    setPath(route.path);
    setEnabled(route.enabled);
    setScenarios(route.scenarios);
    setActiveScenarioId(route.activeScenarioId);
    setEditingScenarioId(route.activeScenarioId);
    setDirty(false);
  }, [route.id, route.method, route.path, route.enabled, route.scenarios, route.activeScenarioId]);

  const editingScenario = scenarios.find((s) => s.id === editingScenarioId) ?? scenarios[0];

  function updateScenario(id: string, patch: Partial<MockScenario>) {
    setScenarios((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setDirty(true);
  }

  function addScenario() {
    const preset = STATUS_PRESETS[0]!;
    const scenario = createScenarioFromPreset(preset);
    // Adding a scenario never switches which one is active — the route
    // keeps responding with its current scenario until the user
    // explicitly switches (§22), even mid-edit.
    setScenarios((prev) => [...prev, scenario]);
    setEditingScenarioId(scenario.id);
    setDirty(true);
  }

  function applyPreset(scenarioId: string, presetStatus: number) {
    const preset = STATUS_PRESETS.find((p) => p.status === presetStatus);
    if (!preset) return;
    updateScenario(scenarioId, { status: preset.status, name: preset.name, body: preset.defaultBody });
  }

  async function handleSave() {
    await updateRoute(route.id, { method, path, enabled, scenarios, activeScenarioId });
    setDirty(false);
  }

  async function handleActivateScenario(id: string) {
    setActiveScenarioId(id);
    setEditingScenarioId(id);
    // Scenario switching takes effect on the live server immediately, per
    // spec §22 — no need to wait for the rest of the form to be saved.
    await updateRoute(route.id, { activeScenarioId: id });
  }

  if (!editingScenario) return null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <label htmlFor="route-method" className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
          Method
        </label>
        <select
          id="route-method"
          value={method}
          onChange={(e) => {
            setMethod(e.target.value as HttpMethod);
            setDirty(true);
          }}
          className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <label htmlFor="route-path" className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
          Path
        </label>
        <input
          id="route-path"
          type="text"
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setDirty(true);
          }}
          placeholder="/users/:id"
          spellCheck={false}
          className="rounded border border-neutral-200 bg-white px-2 py-1.5 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />

        <span className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Enabled</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setDirty(true);
          }}
          aria-label="Route enabled"
          className="h-4 w-4 justify-self-start rounded border-neutral-300 text-blue-600 dark:border-neutral-700"
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="scenario-select" className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
            Scenario
          </label>
          <button type="button" onClick={addScenario} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
            + Add Scenario
          </button>
        </div>
        <div className="flex items-center gap-2">
          <select
            id="scenario-select"
            value={editingScenario.id}
            onChange={(e) => setEditingScenarioId(e.target.value)}
            className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.status})
              </option>
            ))}
          </select>
          {editingScenario.id === activeScenarioId ? (
            <span className="whitespace-nowrap rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-400">
              ● Active
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void handleActivateScenario(editingScenario.id)}
              className="whitespace-nowrap rounded bg-neutral-100 px-2 py-1 text-xs font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              Set Active
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <label htmlFor="scenario-preset" className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
          Preset
        </label>
        <select
          id="scenario-preset"
          value=""
          onChange={(e) => {
            if (e.target.value) applyPreset(editingScenario.id, Number(e.target.value));
            e.target.value = "";
          }}
          className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">Choose a preset…</option>
          {STATUS_PRESETS.map((p) => (
            <option key={p.status} value={p.status}>
              {p.name}
            </option>
          ))}
        </select>

        <label htmlFor="scenario-status" className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
          Status
        </label>
        <input
          id="scenario-status"
          type="number"
          min={100}
          max={599}
          value={editingScenario.status}
          onChange={(e) => updateScenario(editingScenario.id, { status: Number(e.target.value) })}
          className="w-24 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />

        <label htmlFor="scenario-delay" className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
          Delay (ms)
        </label>
        <input
          id="scenario-delay"
          type="number"
          min={0}
          max={MAX_DELAY_MS}
          value={editingScenario.delayMs}
          onChange={(e) => updateScenario(editingScenario.id, { delayMs: Math.min(MAX_DELAY_MS, Math.max(0, Number(e.target.value))) })}
          className="w-24 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>
      <p className="-mt-2 text-xs text-neutral-400 dark:text-neutral-600">Maximum delay: {MAX_DELAY_MS / 1000}s.</p>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Headers</p>
        {editingScenario.headers.map((h) => (
          <div key={h.id} className="mb-1 flex items-center gap-2">
            <input
              type="checkbox"
              checked={h.enabled}
              onChange={(e) =>
                updateScenario(editingScenario.id, {
                  headers: editingScenario.headers.map((row) => (row.id === h.id ? { ...row, enabled: e.target.checked } : row)),
                })
              }
              aria-label="Enable header"
              className="h-4 w-4 rounded border-neutral-300 text-blue-600 dark:border-neutral-700"
            />
            <input
              type="text"
              value={h.key}
              placeholder="Header"
              onChange={(e) =>
                updateScenario(editingScenario.id, {
                  headers: editingScenario.headers.map((row) => (row.id === h.id ? { ...row, key: e.target.value } : row)),
                })
              }
              className="w-1/3 rounded border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <input
              type="text"
              value={h.value}
              placeholder="Value"
              onChange={(e) =>
                updateScenario(editingScenario.id, {
                  headers: editingScenario.headers.map((row) => (row.id === h.id ? { ...row, value: e.target.value } : row)),
                })
              }
              className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            updateScenario(editingScenario.id, {
              headers: [...editingScenario.headers, { id: `h_${Date.now()}`, key: "", value: "", enabled: true }],
            })
          }
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          + Add header
        </button>
      </div>

      <div className="flex flex-1 flex-col">
        <label htmlFor="scenario-body" className="mb-1 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
          Body
        </label>
        <textarea
          id="scenario-body"
          value={editingScenario.body}
          onChange={(e) => updateScenario(editingScenario.id, { body: e.target.value })}
          spellCheck={false}
          rows={8}
          className="w-full flex-1 rounded border border-neutral-200 bg-white p-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}
