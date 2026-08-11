import { create } from "zustand";
import type { MockRoute, RequestLogEntry } from "@api-lab/mock-engine";
import {
  MockAdminError,
  createRoute as adminCreateRoute,
  deleteRoute as adminDeleteRoute,
  getStatus,
  listLogs,
  listRoutes,
  startServer,
  stopServer,
  updateRoute as adminUpdateRoute,
  type MockServerStatus,
} from "../lib/mockAdmin";

/**
 * Dedicated store for the Mock Server management UI — deliberately
 * separate from `useAppStore`. Everything here talks to a remote HTTP
 * admin API (the mock server process) rather than reading/writing local
 * workspace state, so it doesn't belong inside the main store's
 * tabs/workspace/environments concerns (see docs/ARCHITECTURE.md's
 * Milestone 9 section).
 */

const BASE_URL_STORAGE_KEY = "api-lab-mock-admin-url";
const DEFAULT_BASE_URL = "http://localhost:4010";

function loadBaseUrl(): string {
  try {
    return localStorage.getItem(BASE_URL_STORAGE_KEY) || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

interface MockStoreState {
  baseUrl: string;
  status: MockServerStatus | null;
  routes: MockRoute[];
  logs: RequestLogEntry[];
  error: string | null;
  loading: boolean;

  setBaseUrl: (url: string) => void;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  createRoute: (route: Partial<MockRoute>) => Promise<void>;
  updateRoute: (id: string, patch: Partial<MockRoute>) => Promise<void>;
  deleteRoute: (id: string) => Promise<void>;
}

function describeError(err: unknown): string {
  if (err instanceof MockAdminError) return err.message;
  return "Unexpected error talking to the mock server.";
}

export const useMockStore = create<MockStoreState>((set, get) => ({
  baseUrl: loadBaseUrl(),
  status: null,
  routes: [],
  logs: [],
  error: null,
  loading: false,

  setBaseUrl: (url) => {
    try {
      localStorage.setItem(BASE_URL_STORAGE_KEY, url);
    } catch {
      // Non-fatal — the in-memory value still updates below.
    }
    set({ baseUrl: url, status: null, routes: [], logs: [], error: null });
  },

  refresh: async () => {
    const { baseUrl } = get();
    set({ loading: true });
    try {
      const [status, routes, logs] = await Promise.all([
        getStatus(baseUrl),
        listRoutes(baseUrl),
        listLogs(baseUrl),
      ]);
      set({ status, routes, logs, error: null, loading: false });
    } catch (err) {
      set({ status: null, error: describeError(err), loading: false });
    }
  },

  start: async () => {
    const { baseUrl, refresh } = get();
    try {
      await startServer(baseUrl);
      await refresh();
    } catch (err) {
      set({ error: describeError(err) });
    }
  },

  stop: async () => {
    const { baseUrl, refresh } = get();
    try {
      await stopServer(baseUrl);
      await refresh();
    } catch (err) {
      set({ error: describeError(err) });
    }
  },

  createRoute: async (route) => {
    const { baseUrl, refresh } = get();
    try {
      await adminCreateRoute(baseUrl, route);
      await refresh();
    } catch (err) {
      set({ error: describeError(err) });
    }
  },

  updateRoute: async (id, patch) => {
    const { baseUrl, refresh } = get();
    try {
      await adminUpdateRoute(baseUrl, id, patch);
      await refresh();
    } catch (err) {
      set({ error: describeError(err) });
    }
  },

  deleteRoute: async (id) => {
    const { baseUrl, refresh } = get();
    try {
      await adminDeleteRoute(baseUrl, id);
      await refresh();
    } catch (err) {
      set({ error: describeError(err) });
    }
  },
}));
