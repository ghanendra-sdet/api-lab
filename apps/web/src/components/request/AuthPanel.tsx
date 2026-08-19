import { useState } from "react";
import { AUTH_TYPES, createDefaultAuthConfig, type AuthType, type AuthConfig } from "@api-lab/auth-engine";
import { useAppStore } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";

const AUTH_LABELS: Record<AuthType, string> = {
  none: "No Auth",
  inherit: "Inherit from parent",
  apiKey: "API Key",
  basic: "Basic Auth",
  bearer: "Bearer Token",
  jwt: "JWT Bearer",
  oauth2: "OAuth 2.0",
};

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 mt-3 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
    >
      {children}
    </label>
  );
}

function textInputClass() {
  return "w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm font-mono hover:border-neutral-300 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700";
}

interface AuthFieldsEditorProps {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
  showInherit?: boolean;
}

export function AuthFieldsEditor({ auth, onChange, showInherit = false }: AuthFieldsEditorProps) {
  const [showSecrets, setShowSecrets] = useState(false);

  function handleTypeChange(type: AuthType) {
    onChange(createDefaultAuthConfig(type));
  }

  const secretFieldType = showSecrets ? "text" : "password";
  const allowedTypes = showInherit ? AUTH_TYPES : AUTH_TYPES.filter((t) => t !== "inherit");

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
        value={auth.type}
        onChange={(e) => handleTypeChange(e.target.value as AuthType)}
        className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm hover:border-neutral-300 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
      >
        {allowedTypes.map((type) => (
          <option key={type} value={type}>
            {AUTH_LABELS[type]}
          </option>
        ))}
      </select>

      {auth.type === "none" && (
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
          This item does not use any authorization.
        </p>
      )}

      {auth.type === "inherit" && (
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
          This item inherits authorization from its parent.
        </p>
      )}

      {auth.type === "oauth2" && (
        <p className="mt-3 rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          OAuth 2.0 support is planned. Selecting it here will block sending until another
          authorization type is chosen — see docs/ARCHITECTURE.md for the planned flow.
        </p>
      )}

      {(auth.type === "apiKey" || auth.type === "basic" || auth.type === "bearer" || auth.type === "jwt") && (
        <div className="mb-1 mt-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Credentials
          </span>
          <button
            type="button"
            onClick={() => setShowSecrets((v) => !v)}
            className="rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
          >
            {showSecrets ? "Hide values" : "Show values"}
          </button>
        </div>
      )}

      {auth.type === "apiKey" && (
        <>
          <FieldLabel htmlFor="auth-apikey-key">Key</FieldLabel>
          <input
            id="auth-apikey-key"
            type="text"
            value={auth.key}
            onChange={(e) => onChange({ ...auth, key: e.target.value })}
            placeholder="X-API-Key"
            spellCheck={false}
            className={textInputClass()}
          />
          <FieldLabel htmlFor="auth-apikey-value">Value</FieldLabel>
          <input
            id="auth-apikey-value"
            type={secretFieldType}
            value={auth.value}
            onChange={(e) => onChange({ ...auth, value: e.target.value })}
            placeholder="{{apiKey}}"
            spellCheck={false}
            autoComplete="off"
            className={textInputClass()}
          />
          <FieldLabel htmlFor="auth-apikey-addto">Add to</FieldLabel>
          <select
            id="auth-apikey-addto"
            value={auth.addTo}
            onChange={(e) => onChange({ ...auth, addTo: e.target.value as "header" | "query" })}
            className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm hover:border-neutral-300 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
          >
            <option value="header">Header</option>
            <option value="query">Query Params</option>
          </select>
        </>
      )}

      {auth.type === "basic" && (
        <>
          <FieldLabel htmlFor="auth-basic-username">Username</FieldLabel>
          <input
            id="auth-basic-username"
            type="text"
            value={auth.username}
            onChange={(e) => onChange({ ...auth, username: e.target.value })}
            placeholder="{{username}}"
            spellCheck={false}
            className={textInputClass()}
          />
          <FieldLabel htmlFor="auth-basic-password">Password</FieldLabel>
          <input
            id="auth-basic-password"
            type={secretFieldType}
            value={auth.password}
            onChange={(e) => onChange({ ...auth, password: e.target.value })}
            placeholder="{{password}}"
            spellCheck={false}
            autoComplete="off"
            className={textInputClass()}
          />
        </>
      )}

      {(auth.type === "bearer" || auth.type === "jwt") && (
        <>
          <FieldLabel htmlFor="auth-token">{auth.type === "jwt" ? "JWT Token" : "Token"}</FieldLabel>
          <input
            id="auth-token"
            type={secretFieldType}
            value={auth.token}
            onChange={(e) => onChange({ ...auth, token: e.target.value })}
            placeholder={auth.type === "jwt" ? "{{jwt}}" : "{{token}}"}
            spellCheck={false}
            autoComplete="off"
            className={textInputClass()}
          />
        </>
      )}

      {auth.type !== "none" && auth.type !== "inherit" && auth.type !== "oauth2" && (
        <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-600">
          Fields support <code className="font-mono">{"{{variables}}"}</code> from the active environment,
          resolved at send time. A manually added header/param with the same name is overridden by this
          configuration.
        </p>
      )}
    </div>
  );
}

import { resolveContainers } from "../../lib/workspaceLookup";
import { resolveInheritedAuth } from "../../lib/authInheritance";

export function AuthPanel({ tab }: { tab: RequestTabState }) {
  const setAuth = useAppStore((s) => s.setAuth);
  const workspace = useAppStore((s) => s.workspace);
  const auth = tab.auth;

  let inheritanceInfo = "";
  if (auth.type === "inherit") {
    const { collection, folder } = resolveContainers(workspace, tab.savedLocation);
    const resolvedAuth = resolveInheritedAuth(auth, folder?.auth, collection?.auth);

    if (tab.savedLocation) {
      if (folder && folder.auth?.type !== "inherit") {
        inheritanceInfo = `↳ Inherited from folder "${folder.name}" (${AUTH_LABELS[resolvedAuth.type]})`;
      } else if (collection) {
        inheritanceInfo = `↳ Inherited from collection "${collection.name}" (${AUTH_LABELS[resolvedAuth.type]})`;
      } else {
        inheritanceInfo = `↳ Inherits from parent folder/collection (${AUTH_LABELS[resolvedAuth.type]})`;
      }
    } else {
      inheritanceInfo = "↳ Inherits from parent folder/collection when saved";
    }
  }

  return (
    <div>
      <AuthFieldsEditor
        auth={auth}
        onChange={(newAuth) => setAuth(tab.id, newAuth)}
        showInherit={true}
      />
      {inheritanceInfo && (
        <div className="mx-4 -mt-2 mb-4 text-xs italic text-neutral-500 dark:text-neutral-400">
          {inheritanceInfo}
        </div>
      )}
    </div>
  );
}
