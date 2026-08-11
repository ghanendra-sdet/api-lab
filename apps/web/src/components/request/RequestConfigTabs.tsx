import type { RequestPanelId } from "@api-lab/shared";
import { useAppStore } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";

const PANELS: { id: RequestPanelId; label: string }[] = [
  { id: "params", label: "Params" },
  { id: "auth", label: "Authorization" },
  { id: "headers", label: "Headers" },
  { id: "body", label: "Body" },
  { id: "scripts", label: "Scripts" },
  { id: "tests", label: "Tests" },
  { id: "contract", label: "Contract" },
];

export function RequestConfigTabs({ tab }: { tab: RequestTabState }) {
  const setActivePanel = useAppStore((s) => s.setActivePanel);

  return (
    <div
      role="tablist"
      aria-label="Request configuration"
      className="flex gap-1 border-b border-neutral-200 px-4 dark:border-neutral-800"
    >
      {PANELS.map((panel) => {
        const isActive = tab.activePanel === panel.id;
        return (
          <button
            key={panel.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => setActivePanel(tab.id, panel.id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              isActive
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
          >
            {panel.label}
          </button>
        );
      })}
    </div>
  );
}
