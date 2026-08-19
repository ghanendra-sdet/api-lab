import { useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { EnvironmentManager } from "../environments/EnvironmentManager";
import { GlobalVariablesManager } from "../globals/GlobalVariablesManager";
import { MockServerManager } from "../mock/MockServerManager";
import { ContractManager } from "../contract/ContractManager";
import { SecurityManager } from "../security/SecurityManager";
import { DocumentationManager } from "../documentation/DocumentationManager";

const MANAGE_ENVIRONMENTS_VALUE = "__manage__";

export function TopBar() {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const environments = useAppStore((s) => s.environments.environments);
  const activeEnvironmentId = useAppStore((s) => s.environments.activeEnvironmentId);
  const setActiveEnvironment = useAppStore((s) => s.setActiveEnvironment);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const environmentsLoadError = useAppStore((s) => s.environmentsLoadError);
  const [managerOpen, setManagerOpen] = useState(false);
  const [globalsManagerOpen, setGlobalsManagerOpen] = useState(false);
  const [mockManagerOpen, setMockManagerOpen] = useState(false);
  const [contractManagerOpen, setContractManagerOpen] = useState(false);
  const [securityManagerOpen, setSecurityManagerOpen] = useState(false);
  const [documentationManagerOpen, setDocumentationManagerOpen] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900 md:hidden"
        >
          <MenuIcon />
        </button>
        <button
          type="button"
          onClick={() => setActiveView("home")}
          aria-label="Go to API Lab home"
          className="flex items-center gap-1.5 rounded text-sm font-semibold tracking-tight hover:opacity-80"
        >
          <span
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded bg-blue-600 text-[11px] font-bold text-white"
          >
            A
          </span>
          <span>API Lab</span>
        </button>
        <span className="hidden text-sm text-neutral-400 sm:inline" aria-hidden="true">
          /
        </span>
        <span className="hidden text-sm text-neutral-500 dark:text-neutral-400 sm:inline">
          Workspace
        </span>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="environment-select" className="sr-only">
          Environment
        </label>
        <select
          id="environment-select"
          value={activeEnvironmentId ?? ""}
          onChange={(e) => {
            const { value } = e.target;
            if (value === MANAGE_ENVIRONMENTS_VALUE) {
              setManagerOpen(true);
              return;
            }
            setActiveEnvironment(value === "" ? null : value);
          }}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm text-neutral-700 hover:border-neutral-300 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-700"
        >
          <option value="">No Environment</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
          <option value={MANAGE_ENVIRONMENTS_VALUE}>Manage Environments…</option>
        </select>

        <button
          type="button"
          onClick={() => setManagerOpen(true)}
          aria-label="Manage environments"
          className={`rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
            environmentsLoadError ? "text-amber-600 dark:text-amber-400" : "text-neutral-500"
          }`}
        >
          <GearIcon />
        </button>

        <button
          type="button"
          onClick={() => setGlobalsManagerOpen(true)}
          aria-label="Manage global variables"
          className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          <GlobeIcon />
        </button>

        <button
          type="button"
          onClick={() => setActiveView(activeView === "performance" ? "request" : "performance")}
          aria-label="Performance"
          aria-pressed={activeView === "performance"}
          className={`rounded px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
            activeView === "performance"
              ? "font-medium text-blue-600 dark:text-blue-400"
              : "text-neutral-500"
          }`}
        >
          Performance
        </button>

        <button
          type="button"
          onClick={() => setMockManagerOpen(true)}
          aria-label="Mock Server"
          className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          Mock Server
        </button>

        <button
          type="button"
          onClick={() => setContractManagerOpen(true)}
          aria-label="Contract"
          className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          Contract
        </button>

        <button
          type="button"
          onClick={() => setSecurityManagerOpen(true)}
          aria-label="Security"
          className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          Security
        </button>

        <button
          type="button"
          onClick={() => setDocumentationManagerOpen(true)}
          aria-label="Documentation"
          className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          Docs
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
      {managerOpen && <EnvironmentManager onClose={() => setManagerOpen(false)} />}
      {globalsManagerOpen && <GlobalVariablesManager onClose={() => setGlobalsManagerOpen(false)} />}
      {mockManagerOpen && <MockServerManager onClose={() => setMockManagerOpen(false)} />}
      {contractManagerOpen && <ContractManager onClose={() => setContractManagerOpen(false)} />}
      {securityManagerOpen && <SecurityManager onClose={() => setSecurityManagerOpen(false)} />}
      {documentationManagerOpen && (
        <DocumentationManager onClose={() => setDocumentationManagerOpen(false)} />
      )}
    </header>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.32.5.66 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M3 12h18M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
