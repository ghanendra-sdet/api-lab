import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveTab } from "../../store/useAppStore";
import { RequestTabs } from "./RequestTabs";
import { RequestBar } from "./RequestBar";
import { RequestConfigTabs } from "./RequestConfigTabs";
import { ParamsPanel } from "./ParamsPanel";
import { AuthPanel } from "./AuthPanel";
import { HeadersPanel } from "./HeadersPanel";
import { BodyPanel } from "./BodyPanel";
import { VariablesPanel } from "./VariablesPanel";
import { ScriptsPanel } from "./ScriptsPanel";
import { TestsPanel } from "./TestsPanel";
import { ResponsePanel } from "../response/ResponsePanel";
import { ContractPanel } from "../contract/ContractPanel";
import { DependenciesPanel } from "./DependenciesPanel";

const HEIGHT_STORAGE_KEY = "api-lab-request-height";
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 800;
const DEFAULT_HEIGHT = 300;

function readStoredHeight(): number {
  if (typeof window === "undefined") return DEFAULT_HEIGHT;
  const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_HEIGHT;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, parsed));
}

export function RequestWorkspace() {
  const tab = useActiveTab();
  const [requestHeight, setRequestHeight] = useState(readStoredHeight);
  const [resizing, setResizing] = useState(false);
  const startRef = useRef<{ y: number; height: number } | null>(null);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, start.height + (e.clientY - start.y)));
    setRequestHeight(next);
  }, []);

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      setResizing(false);
      startRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      setRequestHeight((current) => {
        window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(current));
        return current;
      });
      void e;
    },
    [handlePointerMove],
  );

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startRef.current = { y: e.clientY, height: requestHeight };
      setResizing(true);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [requestHeight, handlePointerMove, handlePointerUp],
  );

  const resetHeight = useCallback(() => {
    setRequestHeight(DEFAULT_HEIGHT);
    window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(DEFAULT_HEIGHT));
  }, []);

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <RequestTabs />
      <RequestBar tab={tab} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Request configuration / builder panel */}
        <div
          className="flex shrink-0 flex-col overflow-y-auto border-b border-neutral-200 dark:border-neutral-800"
          style={{ height: requestHeight }}
        >
          <RequestConfigTabs tab={tab} />
          <div className="min-h-[180px] flex-1">
            {tab.activePanel === "params" && <ParamsPanel tab={tab} />}
            {tab.activePanel === "auth" && <AuthPanel tab={tab} />}
            {tab.activePanel === "headers" && <HeadersPanel tab={tab} />}
            {tab.activePanel === "body" && <BodyPanel tab={tab} />}
            {tab.activePanel === "variables" && <VariablesPanel tab={tab} />}
            {tab.activePanel === "scripts" && <ScriptsPanel tab={tab} />}
            {tab.activePanel === "tests" && <TestsPanel tab={tab} />}
            {tab.activePanel === "contract" && <ContractPanel tab={tab} />}
            {tab.activePanel === "dependencies" && <DependenciesPanel tab={tab} />}
          </div>
        </div>

        {/* Resizer Handle */}
        <div
          role="slider"
          aria-orientation="vertical"
          aria-label="Resize request panel"
          aria-valuemin={MIN_HEIGHT}
          aria-valuemax={MAX_HEIGHT}
          aria-valuenow={requestHeight}
          title="Drag to resize. Double-click to reset."
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={resetHeight}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") setRequestHeight((h) => Math.max(MIN_HEIGHT, h - 16));
            if (e.key === "ArrowDown") setRequestHeight((h) => Math.min(MAX_HEIGHT, h + 16));
          }}
          className={`h-1.5 cursor-row-resize touch-none select-none border-b border-t border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 ${
            resizing ? "bg-blue-500/40" : "hover:bg-blue-500/20"
          }`}
        />

        {/* Response panel */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ResponsePanel />
        </div>
      </div>
    </div>
  );
}
