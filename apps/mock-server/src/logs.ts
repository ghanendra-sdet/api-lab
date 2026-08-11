import { MAX_LOG_ENTRIES, createLogId, type RequestLogEntry } from "@api-lab/mock-engine";

/** In-memory ring buffer — logs are diagnostic/session-scoped, not
 * persisted data, so they reset with the process, same as the fixture
 * server's behavior in earlier milestones. Never holds request bodies or
 * the Authorization header (see docs/SECURITY.md). */
export class RequestLog {
  private entries: RequestLogEntry[] = [];

  add(entry: Omit<RequestLogEntry, "id">): RequestLogEntry {
    const full: RequestLogEntry = { id: createLogId(), ...entry };
    this.entries.unshift(full);
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.length = MAX_LOG_ENTRIES;
    }
    return full;
  }

  list(): RequestLogEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }
}
