import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { CollectionSidebar } from "../collections/CollectionSidebar";

const WIDTH_STORAGE_KEY = "api-lab-sidebar-width";
const MIN_WIDTH = 200;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 256;

function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
}

export function Sidebar() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const [width, setWidth] = useState(readStoredWidth);
  const [resizing, setResizing] = useState(false);
  const startRef = useRef<{ x: number; width: number } | null>(null);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, start.width + (e.clientX - start.x)));
    setWidth(next);
  }, []);

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      setResizing(false);
      startRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      setWidth((current) => {
        window.localStorage.setItem(WIDTH_STORAGE_KEY, String(current));
        return current;
      });
      void e;
    },
    [handlePointerMove],
  );

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startRef.current = { x: e.clientX, width };
      setResizing(true);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [width, handlePointerMove, handlePointerUp],
  );

  const resetWidth = useCallback(() => {
    setWidth(DEFAULT_WIDTH);
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(DEFAULT_WIDTH));
  }, []);

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  return (
    <>
      {/* Desktop: always-visible, resizable sidebar column */}
      <div className="relative hidden shrink-0 md:flex" style={{ width }}>
        <aside
          className="min-w-0 flex-1 overflow-y-auto border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950"
          aria-label="Collections sidebar"
        >
          <CollectionSidebar />
        </aside>
        <div
          role="slider"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          title="Drag to resize. Double-click to reset."
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={resetWidth}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setWidth((w) => Math.max(MIN_WIDTH, w - 16));
            if (e.key === "ArrowRight") setWidth((w) => Math.min(MAX_WIDTH, w + 16));
          }}
          className={`absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none select-none ${
            resizing ? "bg-blue-500/40" : "hover:bg-blue-500/20"
          }`}
        />
      </div>

      {/* Mobile/tablet: overlay drawer toggled from the TopBar */}
      {sidebarCollapsed && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close sidebar overlay"
            onClick={toggleSidebar}
            className="absolute inset-0 bg-black/30"
          />
          <aside
            className="relative z-50 h-full w-64 border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
            aria-label="Collections sidebar"
          >
            <CollectionSidebar />
          </aside>
        </div>
      )}
    </>
  );
}
