import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { MainWorkspace } from "./MainWorkspace";

export function AppShell() {
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <MainWorkspace />
      </div>
    </div>
  );
}
