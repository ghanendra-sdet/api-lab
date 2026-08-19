import { useState } from "react";
import type { Collection } from "@api-lab/workspace-engine";
import type { Variable } from "@api-lab/environment-engine";
import type { AuthConfig } from "@api-lab/auth-engine";
import { useAppStore } from "../../store/useAppStore";
import { Dialog } from "../common/Dialog";
import { VariableEditor } from "../environments/VariableEditor";
import { AuthFieldsEditor } from "../request/AuthPanel";
import { createId } from "../../lib/id";

interface CollectionSettingsDialogProps {
  collection: Collection;
  onClose: () => void;
}

export function CollectionSettingsDialog({ collection, onClose }: CollectionSettingsDialogProps) {
  const updateCollectionVariables = useAppStore((s) => s.updateCollectionVariables);
  const updateCollectionAuth = useAppStore((s) => s.updateCollectionAuth);

  const [activeTab, setActiveTab] = useState<"variables" | "auth">("variables");
  const [variables, setVariables] = useState<Variable[]>(collection.variables ?? []);
  const [auth, setAuth] = useState<AuthConfig>(collection.auth ?? { type: "none" });

  function handleAddVariable() {
    const newVar: Variable = {
      id: createId("var"),
      key: "",
      value: "",
      enabled: true,
      secret: false,
    };
    setVariables((prev) => [...prev, newVar]);
  }

  function handleUpdateVariable(
    variableId: string,
    patch: Partial<Pick<Variable, "key" | "value" | "enabled" | "secret">>,
  ) {
    setVariables((prev) =>
      prev.map((v) => (v.id === variableId ? { ...v, ...patch } : v)),
    );
  }

  function handleRemoveVariable(variableId: string) {
    setVariables((prev) => prev.filter((v) => v.id !== variableId));
  }

  function handleSave() {
    updateCollectionVariables(collection.id, variables);
    updateCollectionAuth(collection.id, auth);
    onClose();
  }

  return (
    <Dialog onClose={onClose} titleId="collection-settings-title" className="w-[36rem] max-w-[94vw] p-4">
      <h2
        id="collection-settings-title"
        className="mb-4 text-base font-semibold text-neutral-800 dark:text-neutral-100"
      >
        Collection Settings: {collection.name}
      </h2>

      {/* Tabs selection */}
      <div className="mb-4 flex border-b border-neutral-200 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setActiveTab("variables")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === "variables"
              ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
              : "border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          }`}
        >
          Variables
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("auth")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === "auth"
              ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
              : "border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          }`}
        >
          Authentication
        </button>
      </div>

      {/* Tab Contents */}
      <div className="mb-6 max-h-[50vh] overflow-y-auto pr-1">
        {activeTab === "variables" ? (
          <div>
            <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
              Collection variables are shared across all requests and folders in this collection.
            </p>
            <VariableEditor
              environmentId=""
              variables={variables}
              onAdd={handleAddVariable}
              onUpdate={handleUpdateVariable}
              onRemove={handleRemoveVariable}
            />
          </div>
        ) : (
          <div>
            <p className="mb-3 px-4 text-xs text-neutral-500 dark:text-neutral-400">
              Set the authentication for this collection. Folders and requests within it can inherit this.
            </p>
            <AuthFieldsEditor
              auth={auth}
              onChange={setAuth}
              showInherit={false}
            />
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}
