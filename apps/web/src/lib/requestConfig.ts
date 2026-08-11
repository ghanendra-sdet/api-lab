import type { RequestConfig } from "@api-lab/workspace-engine";
import type { RequestTabState } from "../types";

export function tabToRequestConfig(tab: RequestTabState): RequestConfig {
  return {
    method: tab.method,
    url: tab.url,
    params: tab.params,
    headers: tab.headers,
    auth: tab.auth,
    bodyMode: tab.bodyMode,
    bodyRawFormat: tab.bodyRawFormat,
    bodyRawContent: tab.bodyRawContent,
    tests: tab.tests,
    extractions: tab.extractions,
  };
}

export function requestConfigToTabFields(config: RequestConfig): Partial<RequestTabState> {
  return {
    method: config.method,
    url: config.url,
    params: config.params,
    headers: config.headers,
    auth: config.auth,
    bodyMode: config.bodyMode,
    bodyRawFormat: config.bodyRawFormat,
    bodyRawContent: config.bodyRawContent,
    tests: config.tests,
    extractions: config.extractions,
  };
}

/**
 * A tab is dirty only when it's linked to a saved request and its current
 * configuration has diverged from the snapshot taken at open/save time.
 * Never-saved tabs aren't "dirty" — that concept only applies to edits
 * against something already saved.
 */
export function isTabDirty(tab: RequestTabState): boolean {
  if (!tab.savedRequestId || !tab.savedSnapshot) return false;
  return JSON.stringify(tabToRequestConfig(tab)) !== JSON.stringify(tab.savedSnapshot);
}
