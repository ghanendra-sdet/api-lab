import { Dialog } from "../common/Dialog";
import { useAppStore } from "../../store/useAppStore";

interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const appFontSize = useAppStore((s) => s.appFontSize);
  const setAppFontSize = useAppStore((s) => s.setAppFontSize);
  const appThemeColor = useAppStore((s) => s.appThemeColor);
  const setAppThemeColor = useAppStore((s) => s.setAppThemeColor);

  return (
    <Dialog onClose={onClose} titleId="settings-title" className="w-[24rem] max-w-[92vw] p-5">
      <div className="flex items-center justify-between border-b border-neutral-200 pb-3 dark:border-neutral-800">
        <h2 id="settings-title" className="text-base font-semibold text-neutral-900 dark:text-white">
          Workspace Settings
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings dialog"
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        >
          <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {/* Font Size customization */}
        <div>
          <label
            htmlFor="font-size-select"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400"
          >
            Font Size
          </label>
          <select
            id="font-size-select"
            value={appFontSize}
            onChange={(e) => setAppFontSize(Number(e.target.value))}
            className="w-full rounded border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-700"
          >
            <option value={12}>12px (Small)</option>
            <option value={14}>14px (Medium - Default)</option>
            <option value={16}>16px (Large)</option>
            <option value={18}>18px (Extra Large)</option>
          </select>
        </div>

        {/* Theme color customization */}
        <div>
          <label
            htmlFor="theme-color-select"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400"
          >
            Accent Color Theme
          </label>
          <select
            id="theme-color-select"
            value={appThemeColor}
            onChange={(e) => setAppThemeColor(e.target.value)}
            className="w-full rounded border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-700"
          >
            <option value="blue">Blue (Default)</option>
            <option value="green">Green (Emerald)</option>
            <option value="purple">Purple (Royal)</option>
            <option value="red">Red (Crimson)</option>
          </select>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700"
        >
          Done
        </button>
      </div>
    </Dialog>
  );
}
