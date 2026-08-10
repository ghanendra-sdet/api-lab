import { useAppStore } from "../../store/useAppStore";
import { CollectionSidebar } from "../collections/CollectionSidebar";

export function Sidebar() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  return (
    <>
      {/* Desktop: always-visible sidebar column */}
      <aside
        className="hidden w-64 shrink-0 border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 md:block"
        aria-label="Collections sidebar"
      >
        <CollectionSidebar />
      </aside>

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
