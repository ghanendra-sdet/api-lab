import { useAppStore } from "../../store/useAppStore";
import { RequestWorkspace } from "../request/RequestWorkspace";
import { PerformanceWorkspace } from "../performance/PerformanceWorkspace";

/**
 * Milestone 10 turns this from a single-pane host into a view switch. The
 * Performance page is a peer of the request workspace rather than a modal:
 * a load test runs for minutes with live charts, which a dialog cannot host
 * without trapping the user.
 */
export function MainWorkspace() {
  const activeView = useAppStore((s) => s.activeView);

  if (activeView === "performance") return <PerformanceWorkspace />;

  return (
    <main className="flex min-w-0 flex-1 overflow-hidden" aria-label="Request workspace">
      <RequestWorkspace />
    </main>
  );
}
