import type { RequestConfig } from "@api-lab/workspace-engine";
import type { RequestTabState } from "../types";
import type { FormDataField, UrlencodedField } from "@api-lab/shared";

export function tabToRequestConfig(tab: RequestTabState): RequestConfig {
  let bodyRawContent = tab.bodyRawContent;
  if (tab.bodyMode === "form-data") {
    bodyRawContent = JSON.stringify(tab.bodyFormData || []);
  } else if (tab.bodyMode === "x-www-form-urlencoded") {
    bodyRawContent = JSON.stringify(tab.bodyUrlencoded || []);
  }

  return {
    method: tab.method,
    url: tab.url,
    params: tab.params,
    headers: tab.headers,
    auth: tab.auth,
    bodyMode: tab.bodyMode,
    bodyRawFormat: tab.bodyRawFormat,
    bodyRawContent,
    tests: tab.tests,
    extractions: tab.extractions,
    preRequestScript: tab.preRequestScript || undefined,
    postResponseScript: tab.postResponseScript || undefined,
    dependsOn: tab.dependsOn.length > 0 ? tab.dependsOn : undefined,
    variables: tab.variables,
  };
}

export function requestConfigToTabFields(config: RequestConfig): Partial<RequestTabState> {
  let bodyFormData: FormDataField[] = [];
  let bodyUrlencoded: UrlencodedField[] = [];
  let bodyRawContent = config.bodyRawContent;

  if (config.bodyMode === "form-data") {
    try {
      bodyFormData = JSON.parse(config.bodyRawContent);
      if (!Array.isArray(bodyFormData)) bodyFormData = [];
    } catch {
      bodyFormData = [];
    }
    bodyRawContent = "";
  } else if (config.bodyMode === "x-www-form-urlencoded") {
    try {
      bodyUrlencoded = JSON.parse(config.bodyRawContent);
      if (!Array.isArray(bodyUrlencoded)) bodyUrlencoded = [];
    } catch {
      bodyUrlencoded = [];
    }
    bodyRawContent = "";
  }

  return {
    method: config.method,
    url: config.url,
    params: config.params,
    headers: config.headers,
    auth: config.auth,
    bodyMode: config.bodyMode,
    bodyRawFormat: config.bodyRawFormat,
    bodyRawContent,
    bodyFormData,
    bodyUrlencoded,
    tests: config.tests,
    extractions: config.extractions,
    preRequestScript: config.preRequestScript ?? "",
    postResponseScript: config.postResponseScript ?? "",
    dependsOn: config.dependsOn ?? [],
    variables: config.variables ?? [],
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
