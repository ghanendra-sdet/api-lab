import type {
  AuthType,
  BodyMode,
  BodyRawFormat,
  HttpMethod,
  KeyValueRow,
  RequestPanelId,
} from "@api-lab/shared";
import type { RequestConfig, RequestLocation } from "@api-lab/workspace-engine";

/** The full editable state of one open request tab. */
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

  /**
   * Set only when this tab is linked to a saved request — undefined means
   * "unsaved" (a brand-new tab that hasn't been saved into any collection
   * yet). Saving a never-saved tab goes through the Save dialog; saving an
   * already-linked tab updates the saved request in place.
   */
  savedRequestId?: string;
  savedLocation?: RequestLocation;
  /** The request config as of the last open/save — used to compute dirty state. */
  savedSnapshot?: RequestConfig;
}
