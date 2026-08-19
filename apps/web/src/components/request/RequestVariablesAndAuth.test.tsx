import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { RequestWorkspace } from "./RequestWorkspace";
import { createEmptyWorkspace } from "@api-lab/workspace-engine";
import { createEmptyEnvironmentWorkspace } from "@api-lab/environment-engine";
import { createEmptyTab } from "../../lib/seedData";
import { tabToRequestConfig, requestConfigToTabFields } from "../../lib/requestConfig";
import { resolveInheritedAuth } from "../../lib/authInheritance";

function resetStore() {
  const freshTab = createEmptyTab();
  useAppStore.setState({
    tabs: [freshTab],
    activeTabId: freshTab.id,
    workspace: createEmptyWorkspace(),
    workspaceLoadError: null,
    environments: createEmptyEnvironmentWorkspace(),
    environmentsLoadError: null,
    globals: [],
    globalsLoadError: null,
  });
}

describe("Request Local Variables & Auth Inheritance UI", () => {
  beforeEach(() => {
    resetStore();
  });

  describe("Request Local Variables UI", () => {
    it("renders the Variables tab and displays empty variables state", () => {
      render(<RequestWorkspace />);

      // Switch to Variables tab
      fireEvent.click(screen.getByRole("tab", { name: "Variables" }));

      expect(screen.getByText("Local Variables")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ Add variable" })).toBeInTheDocument();
    });

    it("allows adding, updating, and removing a local variable on the active tab", () => {
      render(<RequestWorkspace />);
      const activeTabId = useAppStore.getState().activeTabId;

      // Switch to Variables tab
      fireEvent.click(screen.getByRole("tab", { name: "Variables" }));

      // Add variable
      fireEvent.click(screen.getByRole("button", { name: "+ Add variable" }));
      expect(useAppStore.getState().tabs.find((t) => t.id === activeTabId)?.variables).toHaveLength(1);

      // Edit Key
      const keyInput = screen.getByPlaceholderText("key");
      fireEvent.change(keyInput, { target: { value: "reqKey" } });
      expect(useAppStore.getState().tabs.find((t) => t.id === activeTabId)?.variables[0]?.key).toBe("reqKey");

      // Edit Value
      const valInput = screen.getByPlaceholderText("value");
      fireEvent.change(valInput, { target: { value: "reqVal" } });
      expect(useAppStore.getState().tabs.find((t) => t.id === activeTabId)?.variables[0]?.value).toBe("reqVal");

      // Remove variable
      fireEvent.click(screen.getByLabelText(/Delete variable/));
      expect(useAppStore.getState().tabs.find((t) => t.id === activeTabId)?.variables).toHaveLength(0);
    });
  });

  describe("Request Config Conversions", () => {
    it("survives RequestTabState -> RequestConfig conversion", () => {
      const tab = createEmptyTab({
        variables: [
          { id: "v1", key: "k1", value: "v1", enabled: true, secret: false },
        ],
      });
      const config = tabToRequestConfig(tab);
      expect(config.variables).toEqual([
        { id: "v1", key: "k1", value: "v1", enabled: true, secret: false },
      ]);
    });

    it("restores variables from RequestConfig -> RequestTabState Partial", () => {
      const config = {
        method: "POST" as const,
        url: "https://example.com",
        params: [],
        headers: [],
        auth: { type: "none" as const },
        bodyMode: "none" as const,
        bodyRawFormat: "JSON" as const,
        bodyRawContent: "",
        tests: [],
        extractions: [],
        variables: [
          { id: "v2", key: "k2", value: "v2", enabled: true, secret: true },
        ],
      };
      const fields = requestConfigToTabFields(config);
      expect(fields.variables).toEqual([
        { id: "v2", key: "k2", value: "v2", enabled: true, secret: true },
      ]);
    });
  });

  describe("Auth Inheritance UI & resolveInheritedAuth integration", () => {
    it("renders the inherit auth type choice and description in the request Authorization panel", () => {
      render(<RequestWorkspace />);

      // Switch to Authorization tab
      fireEvent.click(screen.getByRole("tab", { name: "Authorization" }));

      // Expect selector to be in document and value to default to "inherit"
      const select = screen.getByRole("combobox", { name: "Authorization Type" });
      expect(select).toHaveValue("inherit");
      expect(screen.getByText("This item inherits authorization from its parent.")).toBeInTheDocument();
      expect(screen.getByText("↳ Inherits from parent folder/collection when saved")).toBeInTheDocument();
    });

    it("displays the correct inheritance indication when saved in a collection", () => {
      const { createCollection } = useAppStore.getState();
      const colId = createCollection("My Collection");

      // Configure Collection Auth
      useAppStore.setState((state) => {
        const collections = state.workspace.collections.map((c) =>
          c.id === colId ? { ...c, auth: { type: "bearer" as const, token: "col-token" } } : c,
        );
        return { workspace: { collections } };
      });

      // Bind tab to collection
      const activeTabId = useAppStore.getState().activeTabId;
      useAppStore.setState((state) => {
        const tabs = state.tabs.map((t) =>
          t.id === activeTabId
            ? { ...t, savedLocation: { collectionId: colId }, savedRequestId: "req-1" }
            : t,
        );
        return { tabs };
      });

      render(<RequestWorkspace />);

      // Switch to Authorization tab
      fireEvent.click(screen.getByRole("tab", { name: "Authorization" }));

      expect(screen.getByText('↳ Inherited from collection "My Collection" (Bearer Token)')).toBeInTheDocument();
    });

    it("displays the correct inheritance indication when saved in a folder", () => {
      const { createCollection, createFolder } = useAppStore.getState();
      const colId = createCollection("My Collection");
      const folderId = createFolder(colId, "My Folder");

      // Configure Folder Auth
      useAppStore.setState((state) => {
        const collections = state.workspace.collections.map((c) => {
          if (c.id === colId) {
            const items = c.items.map((item) =>
              item.id === folderId ? { ...item, auth: { type: "basic" as const, username: "u", password: "p" } } : item,
            );
            return { ...c, items };
          }
          return c;
        });
        return { workspace: { collections } };
      });

      // Bind tab to folder
      const activeTabId = useAppStore.getState().activeTabId;
      useAppStore.setState((state) => {
        const tabs = state.tabs.map((t) =>
          t.id === activeTabId
            ? { ...t, savedLocation: { collectionId: colId, folderId }, savedRequestId: "req-1" }
            : t,
        );
        return { tabs };
      });

      render(<RequestWorkspace />);

      // Switch to Authorization tab
      fireEvent.click(screen.getByRole("tab", { name: "Authorization" }));

      expect(screen.getByText('↳ Inherited from folder "My Folder" (Basic Auth)')).toBeInTheDocument();
    });

    it("falls back to collection auth if folder auth is also inherit", () => {
      const { createCollection, createFolder } = useAppStore.getState();
      const colId = createCollection("My Collection");
      const folderId = createFolder(colId, "My Folder");

      // Configure Collection Auth to basic, leave Folder Auth as inherit
      useAppStore.setState((state) => {
        const collections = state.workspace.collections.map((c) => {
          if (c.id === colId) {
            const items = c.items.map((item) =>
              item.id === folderId ? { ...item, auth: { type: "inherit" as const } } : item,
            );
            return { ...c, items, auth: { type: "basic" as const, username: "u", password: "p" } };
          }
          return c;
        });
        return { workspace: { collections } };
      });

      const activeTabId = useAppStore.getState().activeTabId;
      useAppStore.setState((state) => {
        const tabs = state.tabs.map((t) =>
          t.id === activeTabId
            ? { ...t, savedLocation: { collectionId: colId, folderId }, savedRequestId: "req-1" }
            : t,
        );
        return { tabs };
      });

      render(<RequestWorkspace />);

      // Switch to Authorization tab
      fireEvent.click(screen.getByRole("tab", { name: "Authorization" }));

      expect(screen.getByText('↳ Inherited from collection "My Collection" (Basic Auth)')).toBeInTheDocument();
    });

    it("verifies resolveInheritedAuth logic", () => {
      const folderAuth = { type: "bearer" as const, token: "folder-tok" };
      const collectionAuth = { type: "basic" as const, username: "u", password: "p" };

      // Request explicit auth does not inherit
      const res1 = resolveInheritedAuth({ type: "apiKey", key: "k", value: "v", addTo: "header" }, folderAuth, collectionAuth);
      expect(res1).toEqual({ type: "apiKey", key: "k", value: "v", addTo: "header" });

      // Request none does not inherit
      const res2 = resolveInheritedAuth({ type: "none" }, folderAuth, collectionAuth);
      expect(res2).toEqual({ type: "none" });

      // Request inherit resolves Folder auth if present
      const res3 = resolveInheritedAuth({ type: "inherit" }, folderAuth, collectionAuth);
      expect(res3).toEqual(folderAuth);

      // Request inherit + Folder inherit resolves Collection auth
      const res4 = resolveInheritedAuth({ type: "inherit" }, { type: "inherit" }, collectionAuth);
      expect(res4).toEqual(collectionAuth);

      // Request inherit + no Folder/Collection auth falls back to none
      const res5 = resolveInheritedAuth({ type: "inherit" }, undefined, undefined);
      expect(res5).toEqual({ type: "none" });
    });
  });
});
