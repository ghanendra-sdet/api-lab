import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import {
  MAX_ROUTES,
  MOCK_ROUTES_FORMAT_VERSION,
  mockRoutesFileSchema,
  type MockRoute,
} from "@api-lab/mock-engine";

/**
 * Mock route definitions live in a versioned, Zod-validated JSON file on
 * the server's own filesystem — deliberately not in the browser's
 * localStorage (see docs/ARCHITECTURE.md's Milestone 9 section: the mock
 * server must be usable from a CLI/CI/self-hosted context with no browser
 * involved at all, so its configuration cannot depend on browser storage).
 *
 * Corruption recovery: an unreadable or invalid file never crashes the
 * server — it's logged and the server starts with an empty route set,
 * exactly like the browser workspace's "never crash on corrupt data"
 * policy from Milestone 3, adapted to a server process (no UI banner to
 * show, so a console warning is the equivalent signal).
 */
export class RouteStore {
  private routes: MockRoute[] = [];
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      const result = mockRoutesFileSchema.safeParse(parsed);
      if (!result.success) {
        console.warn(`[mock-server] Ignoring invalid routes file at ${this.filePath}: ${result.error.message}`);
        return;
      }
      this.routes = result.data.routes;
    } catch (err) {
      console.warn(`[mock-server] Failed to read routes file at ${this.filePath}:`, err);
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const file = { version: MOCK_ROUTES_FORMAT_VERSION, routes: this.routes };
      writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf-8");
    } catch (err) {
      console.warn(`[mock-server] Failed to persist routes file at ${this.filePath}:`, err);
    }
  }

  list(): MockRoute[] {
    return this.routes;
  }

  get(id: string): MockRoute | undefined {
    return this.routes.find((r) => r.id === id);
  }

  create(route: MockRoute): { ok: true; route: MockRoute } | { ok: false; error: string } {
    if (this.routes.length >= MAX_ROUTES) {
      return { ok: false, error: `Route limit reached (${MAX_ROUTES}).` };
    }
    this.routes.push(route);
    this.save();
    return { ok: true, route };
  }

  update(id: string, patch: Partial<Omit<MockRoute, "id" | "createdAt">>): MockRoute | undefined {
    const index = this.routes.findIndex((r) => r.id === id);
    if (index === -1) return undefined;
    const updated: MockRoute = { ...this.routes[index]!, ...patch, updatedAt: new Date().toISOString() };
    this.routes[index] = updated;
    this.save();
    return updated;
  }

  remove(id: string): boolean {
    const before = this.routes.length;
    this.routes = this.routes.filter((r) => r.id !== id);
    if (this.routes.length !== before) {
      this.save();
      return true;
    }
    return false;
  }
}
