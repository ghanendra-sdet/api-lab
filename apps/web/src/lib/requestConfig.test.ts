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
      },
    });
    tab.url = "https://example.com/changed";
    expect(isTabDirty(tab)).toBe(true);
  });
});
