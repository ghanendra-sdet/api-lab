import type {
  AuthType,
  BodyMode,
  BodyRawFormat,
  HttpMethod,
  KeyValueRow,
  RequestPanelId,
} from "@api-lab/shared";

/** A saved request inside the collections sidebar (static/local for Milestone 1). */
export interface SavedRequest {
  id: string;
  name: string;
  method: HttpMethod;
}

/** A collection node in the sidebar tree. */
export interface Collection {
  id: string;
  name: string;
  requests: SavedRequest[];
}

/** The full editable state of one open request tab. Not persisted yet — Milestone 3. */
export interface RequestTabState {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  activePanel: RequestPanelId;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  authType: AuthType;
  bodyMode: BodyMode;
  bodyRawFormat: BodyRawFormat;
  bodyRawContent: string;
  preRequestScript: string;
  postResponseScript: string;
  testsScript: string;
}

export type EnvironmentOption = "none" | "development" | "testing" | "production";
