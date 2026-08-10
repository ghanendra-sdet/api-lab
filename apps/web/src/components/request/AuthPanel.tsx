import { AUTH_TYPES, type AuthType } from "@api-lab/shared";
import { useAppStore } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";

const AUTH_LABELS: Record<AuthType, string> = {
  none: "No Auth",
  apiKey: "API Key",
  basic: "Basic Auth",
  bearer: "Bearer Token",
  jwt: "JWT",
  oauth2: "OAuth 2.0",
};

export function AuthPanel({ tab }: { tab: RequestTabState }) {
  const setAuthType = useAppStore((s) => s.setAuthType);

  return (
    <div className="max-w-md p-4">
      <label
        htmlFor="auth-type-select"
        className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
      >
        Authorization Type
      </label>
      <select
        id="auth-type-select"
        value={tab.authType}
        onChange={(e) => setAuthType(tab.id, e.target.value as AuthType)}
        className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm hover:border-neutral-300 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
      >
        {AUTH_TYPES.map((type) => (
          <option key={type} value={type}>
            {AUTH_LABELS[type]}
          </option>
        ))}
      </select>

      {tab.authType === "none" ? (
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
          This request does not use any authorization.
        </p>
      ) : (
        <p className="mt-3 rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {AUTH_LABELS[tab.authType]} configuration fields ship in Milestone 5, once the
          authentication engine exists.
        </p>
      )}
    </div>
  );
}
