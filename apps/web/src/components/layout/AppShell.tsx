import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { MainWorkspace } from "./MainWorkspace";

export function AppShell() {
  return (
    <div className="flex h-full flex-col">
      {/* Skip navigation link — visually hidden until focused.
          Allows keyboard / screen-reader users to bypass TopBar and sidebar. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[9999] focus:rounded focus:bg-blue-600 focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold focus:text-white focus:shadow-md focus:outline-none"
      >
        Skip to main content
      </a>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <MainWorkspace />
      </div>
    </div>
  );
}
