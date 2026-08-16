import { useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";
import {
  resolveDependencyOrder,
  type Workspace,
} from "@api-lab/workspace-engine";

interface DependenciesPanelProps {
  tab: RequestTabState;
}

interface SelectableRequest {
  id: string;
  name: string;
  displayName: string;
}

export function DependenciesPanel({ tab }: DependenciesPanelProps) {
  const workspace = useAppStore((s) => s.workspace);
  const setTabDependsOn = useAppStore((s) => s.setTabDependsOn);

  const [selectedId, setSelectedId] = useState("");

  const targetId = tab.savedRequestId || tab.id;

  // 1. Build a local helper to find request details in workspace
  function findRequestDetails(ws: Workspace, depId: string) {
    for (const col of ws.collections) {
      for (const item of col.items) {
        if (item.type === "folder") {
          for (const req of item.items) {
            if (req.id === depId) {
              return {
                name: req.name,
                path: `${col.name} › ${item.name} › ${req.name}`,
                exists: true,
              };
            }
          }
        } else if (item.type === "request") {
          if (item.id === depId) {
            return {
              name: item.name,
              path: `${col.name} › ${item.name}`,
              exists: true,
            };
          }
        }
      }
    }
    return {
      name: `Deleted request (ID: ${depId})`,
      path: `Deleted request (ID: ${depId})`,
      exists: false,
    };
  }

  // 2. Build list of selectable requests across all collections/folders
  const selectableRequests: SelectableRequest[] = [];
  for (const col of workspace.collections) {
    for (const item of col.items) {
      if (item.type === "folder") {
        for (const req of item.items) {
          if (req.id !== targetId) {
            selectableRequests.push({
              id: req.id,
              name: req.name,
              displayName: `${col.name} › ${item.name} › ${req.name}`,
            });
          }
        }
      } else if (item.type === "request") {
        if (item.id !== targetId) {
          selectableRequests.push({
            id: item.id,
            name: item.name,
            displayName: `${col.name} › ${item.name}`,
          });
        }
      }
    }
  }

  // Filter out requests already added as dependencies
  const filteredSelectable = selectableRequests.filter(
    (r) => !tab.dependsOn.includes(r.id)
  );

  // 3. Helper to update dependencies on the tab
  function handleAdd() {
    if (!selectedId) return;
    const nextDepends = [...tab.dependsOn, selectedId];
    setTabDependsOn(tab.id, nextDepends);
    setSelectedId("");
  }

  function handleRemove(depId: string) {
    const nextDepends = tab.dependsOn.filter((id) => id !== depId);
    setTabDependsOn(tab.id, nextDepends);
  }

  // 4. Perform live canonical dependency validation and build order
  function buildLocalDependencyMap(ws: Workspace): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const col of ws.collections) {
      for (const item of col.items) {
        if (item.type === "folder") {
          for (const req of item.items) {
            map[req.id] = req.request.dependsOn || [];
          }
        } else if (item.type === "request") {
          map[item.id] = item.request.dependsOn || [];
        }
      }
    }
    return map;
  }

  const dependencyMap = buildLocalDependencyMap(workspace);
  dependencyMap[targetId] = tab.dependsOn;

  const validationResult = resolveDependencyOrder(targetId, dependencyMap);

  let validationErrorMsg = "";
  let executionSteps: { id: string; name: string; stepNum: number; isTarget: boolean }[] = [];

  if (!validationResult.ok) {
    const error = validationResult.error;
    if (error.type === "self-dependency") {
      validationErrorMsg = "A request cannot depend on itself.";
    } else if (error.type === "circular-dependency") {
      const chainNames = error.chain.map((id) => {
        if (id === targetId) return `${tab.name} (Current)`;
        return findRequestDetails(workspace, id).name;
      });
      validationErrorMsg = `Circular dependency detected: ${chainNames.join(" → ")}`;
    } else {
      validationErrorMsg = "Invalid dependency configuration detected.";
    }
  } else {
    executionSteps = validationResult.order.map((id, idx) => {
      const isTarget = id === targetId;
      const details = findRequestDetails(workspace, id);
      const name = isTarget ? `${tab.name} (Current)` : details.name;
      return { id, name, stepNum: idx + 1, isTarget };
    });
  }

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
          Request Dependencies
        </h3>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Configure prerequisite requests that must run before this request executes.
        </p>
      </div>

      {/* Add Dependency Section */}
      <div className="flex gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <label
            htmlFor="add-dependency-select"
            className="block text-xs font-medium text-neutral-500 mb-1"
          >
            Prerequisite Request
          </label>
          {filteredSelectable.length === 0 ? (
            <select
              id="add-dependency-select"
              disabled
              className="w-full h-9 rounded border border-neutral-200 px-3 text-sm bg-neutral-50 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <option>No other requests available to select</option>
            </select>
          ) : (
            <select
              id="add-dependency-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full h-9 rounded border border-neutral-200 px-3 text-sm bg-white text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            >
              <option value="">— Select a Request —</option>
              {filteredSelectable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.displayName}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          type="button"
          disabled={!selectedId}
          onClick={handleAdd}
          className="h-9 px-4 rounded bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Add Dependency
        </button>
      </div>

      {/* Dependencies List */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
          Prerequisites List
        </h4>
        {tab.dependsOn.length === 0 ? (
          <p className="text-sm text-neutral-500 italic dark:text-neutral-400">
            No dependencies configured. This request will execute immediately when sent.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 border border-neutral-200 rounded-md dark:divide-neutral-800 dark:border-neutral-800">
            {tab.dependsOn.map((depId) => {
              const details = findRequestDetails(workspace, depId);
              return (
                <li
                  key={depId}
                  className="flex items-center justify-between p-3 text-sm"
                >
                  <div className="flex flex-col">
                    <span
                      className={`font-medium ${
                        details.exists
                          ? "text-neutral-800 dark:text-neutral-200"
                          : "text-red-600 dark:text-red-400 font-semibold"
                      }`}
                    >
                      {details.name}
                    </span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      {details.exists ? details.path : "Missing reference"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(depId)}
                    aria-label={`Remove dependency ${details.name}`}
                    className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 font-semibold px-2 py-1 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Live Validation Warnings */}
      {validationErrorMsg && (
        <div
          role="alert"
          className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-400"
        >
          <div className="font-semibold mb-1">Graph Validation Failed</div>
          <div>{validationErrorMsg}</div>
        </div>
      )}

      {/* Execution order chain display */}
      {!validationErrorMsg && executionSteps.length > 0 && (
        <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800 space-y-2">
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
            Execution Sequence
          </h4>
          <ol className="relative border-l border-neutral-200 dark:border-neutral-800 ml-2">
            {executionSteps.map((step) => (
              <li key={step.id} className="mb-4 ml-6">
                <span className="absolute flex items-center justify-center w-6 h-6 bg-neutral-100 rounded-full -left-3 ring-8 ring-white dark:ring-neutral-900 dark:bg-neutral-800">
                  <span className="text-xs font-mono font-bold text-neutral-500 dark:text-neutral-400">
                    {step.stepNum}
                  </span>
                </span>
                <div
                  className={`text-sm ${
                    step.isTarget
                      ? "font-bold text-blue-600 dark:text-blue-400"
                      : "text-neutral-700 dark:text-neutral-300"
                  }`}
                >
                  {step.name}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
