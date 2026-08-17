import { describe, expect, it } from "vitest";
import { isTabDirty } from "./requestConfig";
import { createEmptyTab } from "./seedData";

describe("isTabDirty", () => {
  it("is never dirty for a tab that isn't linked to a saved request", () => {
    const tab = createEmptyTab({ url: "https://example.com" });
    expect(isTabDirty(tab)).toBe(false);
  });

  it("is not dirty right after linking to a saved snapshot", () => {
    const tab = createEmptyTab({
      url: "https://example.com",
      // D.1 Step 5 changed `createEmptyTab`'s own default `auth` to
      // `{type:"inherit"}` (a brand-new, unsaved request's creation-time
      // default — see seedData.ts). A tab that is *linked to a saved
      // snapshot* reflects whatever that snapshot's own auth is, which in
      // real app flow comes from `requestConfigToTabFields`, not from
      // `createEmptyTab`'s defaults — so this override keeps the tab and
      // its snapshot consistent, exactly as the real linking flow would.
      auth: { type: "none" },
      savedRequestId: "req-1",
      savedLocation: { collectionId: "c1" },
      savedSnapshot: {
        method: "GET",
        url: "https://example.com",
        params: [],
        headers: [],
        auth: { type: "none" },
        bodyMode: "none",
        bodyRawFormat: "JSON",
        bodyRawContent: "",
        tests: [],
        extractions: [],
      },
    });
    expect(isTabDirty(tab)).toBe(false);
  });

  it("is dirty once the tab's config diverges from its saved snapshot", () => {
    const tab = createEmptyTab({
      url: "https://example.com",
      savedRequestId: "req-1",
      savedLocation: { collectionId: "c1" },
      savedSnapshot: {
        method: "GET",
        url: "https://example.com",
        params: [],
        headers: [],
        auth: { type: "none" },
        bodyMode: "none",
        bodyRawFormat: "JSON",
        bodyRawContent: "",
        tests: [],
        extractions: [],
      },
    });
    tab.url = "https://example.com/changed";
    expect(isTabDirty(tab)).toBe(true);
  });
});
