import type { KeyValueRow } from "@api-lab/shared";
import type { RequestConfig } from "@api-lab/workspace-engine";

let counter = 0;
export function createRowId(): string {
  counter += 1;
  return `import_row_${Date.now().toString(36)}_${counter}`;
}

export function row(key: string, value: string, enabled = true, description?: string): KeyValueRow {
  return { id: createRowId(), key, value, enabled, ...(description ? { description } : {}) };
}

export function emptyRequestConfig(overrides: Partial<RequestConfig> = {}): RequestConfig {
  return {
    method: "GET",
    url: "",
    params: [],
    headers: [],
    auth: { type: "none" },
    bodyMode: "none",
    bodyRawFormat: "JSON",
    bodyRawContent: "",
    ...overrides,
  };
}
