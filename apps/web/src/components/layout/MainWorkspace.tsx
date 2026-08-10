import { RequestWorkspace } from "../request/RequestWorkspace";

export function MainWorkspace() {
  return (
    <main className="flex min-w-0 flex-1 overflow-hidden" aria-label="Request workspace">
      <RequestWorkspace />
    </main>
  );
}
