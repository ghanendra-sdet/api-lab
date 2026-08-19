import { describe, expect, it } from "vitest";
import { isTabDirty, tabToRequestConfig, requestConfigToTabFields } from "./requestConfig";
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
        variables: [],
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
        variables: [],
      },
    });
    tab.url = "https://example.com/changed";
    expect(isTabDirty(tab)).toBe(true);
  });
});

describe("requestConfig mapping and backward compatibility", () => {
  it("serializes form-data and urlencoded tabs into bodyRawContent JSON string", () => {
    const tab = createEmptyTab({
      bodyMode: "form-data",
      bodyFormData: [
        { type: "text", key: "foo", value: "bar", enabled: true },
        { type: "file", key: "fileField", file: { name: "test.txt" }, enabled: true },
      ],
    });
    const config = tabToRequestConfig(tab);
    expect(config.bodyRawContent).toBe(
      JSON.stringify([
        { type: "text", key: "foo", value: "bar", enabled: true },
        { type: "file", key: "fileField", file: { name: "test.txt" }, enabled: true },
      ])
    );
  });

  it("deserializes form-data and urlencoded configurations back to arrays", () => {
    const serializedFormData = JSON.stringify([
      { type: "text", key: "hello", value: "world", enabled: true },
    ]);
    const config = {
      method: "POST" as const,
      url: "https://example.com",
      params: [],
      headers: [],
      auth: { type: "none" as const },
      bodyMode: "form-data" as const,
      bodyRawFormat: "JSON" as const,
      bodyRawContent: serializedFormData,
      tests: [],
      extractions: [],
    };
    const tabFields = requestConfigToTabFields(config);
    expect(tabFields.bodyFormData).toEqual([
      { type: "text", key: "hello", value: "world", enabled: true },
    ]);
    expect(tabFields.bodyRawContent).toBe("");
  });

  it("safely defaults missing form fields for backward compatibility", () => {
    const legacyConfig = {
      method: "GET" as const,
      url: "https://example.com",
      params: [],
      headers: [],
      auth: { type: "none" as const },
      bodyMode: "none" as const,
      bodyRawFormat: "JSON" as const,
      bodyRawContent: "",
      tests: [],
      extractions: [],
    };
    const tabFields = requestConfigToTabFields(legacyConfig);
    expect(tabFields.bodyFormData).toEqual([]);
    expect(tabFields.bodyUrlencoded).toEqual([]);
  });
});

