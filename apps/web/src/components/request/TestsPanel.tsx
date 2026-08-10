import { useAppStore } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";

export function TestsPanel({ tab }: { tab: RequestTabState }) {
  const setTestsScript = useAppStore((s) => s.setTestsScript);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <p className="rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        Assertions don't run yet — the test engine ships in Milestone 7.
      </p>
      <label
        htmlFor="tests-script"
        className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
      >
        Tests
      </label>
      <textarea
        id="tests-script"
        value={tab.testsScript}
        onChange={(e) => setTestsScript(tab.id, e.target.value)}
        spellCheck={false}
        placeholder="Write assertions here..."
        className="flex-1 resize-none rounded border border-neutral-200 bg-white p-2 font-mono text-sm text-neutral-800 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
      />
    </div>
  );
}
