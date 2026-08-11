import type {
  BodyMode,
  BodyRawFormat,
  HttpMethod,
  KeyValueRow,
  RequestPanelId,
} from "@api-lab/shared";
import type { AuthConfig } from "@api-lab/auth-engine";
import type { Assertion } from "@api-lab/test-engine";
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
  auth: AuthConfig;
  bodyMode: BodyMode;
  bodyRawFormat: BodyRawFormat;
  bodyRawContent: string;
  preRequestScript: string;
  postResponseScript: string;
  /** Structured, non-executable assertions — see @api-lab/test-engine.
   * Replaces the Milestone 1-6 free-text `testsScript` placeholder now
   * that a real (script-free) test engine exists. */
  tests: Assertion[];

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
