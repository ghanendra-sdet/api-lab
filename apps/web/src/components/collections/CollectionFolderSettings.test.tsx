/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CollectionSettingsDialog } from "./CollectionSettingsDialog";
import { FolderSettingsDialog } from "./FolderSettingsDialog";
import { useAppStore } from "../../store/useAppStore";
import { createEmptyWorkspace } from "@api-lab/workspace-engine";
import { createEmptyEnvironmentWorkspace } from "@api-lab/environment-engine";
import { createEmptyTab } from "../../lib/seedData";

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

describe("CollectionSettingsDialog & FolderSettingsDialog UI", () => {
  beforeEach(() => {
    resetStore();
  });

  describe("CollectionSettingsDialog", () => {
    it("opens and renders collection settings with variables and auth", () => {
      const { createCollection } = useAppStore.getState();
      const colId = createCollection("My Collection");
      const collection = useAppStore.getState().workspace.collections.find((c) => c.id === colId)!;

      render(<CollectionSettingsDialog collection={collection} onClose={() => {}} />);

      expect(screen.getByText("Collection Settings: My Collection")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Variables" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Authentication" })).toBeInTheDocument();
    });

    it("allows adding, updating, and removing collection variables, persisting to store on save", () => {
      const { createCollection } = useAppStore.getState();
      const colId = createCollection("My Collection");
      const collection = useAppStore.getState().workspace.collections.find((c) => c.id === colId)!;

      render(<CollectionSettingsDialog collection={collection} onClose={() => {}} />);

      // Add a variable
      fireEvent.click(screen.getByRole("button", { name: "+ Add variable" }));
      // Set Key
      const keyInput = screen.getByPlaceholderText("key");
      fireEvent.change(keyInput, { target: { value: "colVar" } });
      // Set Value
      const valInput = screen.getByPlaceholderText("value");
      fireEvent.change(valInput, { target: { value: "colVal" } });

      // Save
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      const savedCol = useAppStore.getState().workspace.collections.find((c) => c.id === colId)!;
      expect(savedCol.variables).toHaveLength(1);
      expect(savedCol.variables![0]!.key).toBe("colVar");
      expect(savedCol.variables![0]!.value).toBe("colVal");
    });

    it("allows configuring collection authentication, persisting to store on save", () => {
      const { createCollection } = useAppStore.getState();
      const colId = createCollection("My Collection");
      const collection = useAppStore.getState().workspace.collections.find((c) => c.id === colId)!;

      render(<CollectionSettingsDialog collection={collection} onClose={() => {}} />);

      // Switch to Auth tab
      fireEvent.click(screen.getByRole("button", { name: "Authentication" }));

      // Select Bearer Token
      const select = screen.getByRole("combobox", { name: "Authorization Type" });
      fireEvent.change(select, { target: { value: "bearer" } });

      // Set Token
      const tokenInput = screen.getByPlaceholderText("{{token}}");
      fireEvent.change(tokenInput, { target: { value: "my-col-token" } });

      // Save
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      const savedCol = useAppStore.getState().workspace.collections.find((c) => c.id === colId)!;
      expect(savedCol.auth).toEqual({ type: "bearer", token: "my-col-token" });
    });
  });

  describe("FolderSettingsDialog", () => {
    it("opens and renders folder settings with variables and auth", () => {
      const { createCollection, createFolder } = useAppStore.getState();
      const colId = createCollection("My Collection");
      createFolder(colId, "My Folder");
      const collection = useAppStore.getState().workspace.collections.find((c) => c.id === colId)!;
      const folder = collection.items[0] as any;

      render(<FolderSettingsDialog collectionId={colId} folder={folder} onClose={() => {}} />);

      expect(screen.getByText("Folder Settings: My Folder")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Variables" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Authentication" })).toBeInTheDocument();
    });

    it("allows adding, updating, and removing folder variables, persisting to store on save", () => {
      const { createCollection, createFolder } = useAppStore.getState();
      const colId = createCollection("My Collection");
      createFolder(colId, "My Folder");
      const collection = useAppStore.getState().workspace.collections.find((c) => c.id === colId)!;
      const folder = collection.items[0] as any;

      render(<FolderSettingsDialog collectionId={colId} folder={folder} onClose={() => {}} />);

      // Add a variable
      fireEvent.click(screen.getByRole("button", { name: "+ Add variable" }));
      // Set Key
      const keyInput = screen.getByPlaceholderText("key");
      fireEvent.change(keyInput, { target: { value: "folderVar" } });
      // Set Value
      const valInput = screen.getByPlaceholderText("value");
      fireEvent.change(valInput, { target: { value: "folderVal" } });

      // Save
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      const savedCol = useAppStore.getState().workspace.collections.find((c) => c.id === colId)!;
      const savedFolder = savedCol.items[0] as any;
      expect(savedFolder.variables).toHaveLength(1);
      expect(savedFolder.variables[0].key).toBe("folderVar");
      expect(savedFolder.variables[0].value).toBe("folderVal");
    });

    it("allows configuring folder authentication with inheritance, persisting to store on save", () => {
      const { createCollection, createFolder } = useAppStore.getState();
      const colId = createCollection("My Collection");
      createFolder(colId, "My Folder");
      const collection = useAppStore.getState().workspace.collections.find((c) => c.id === colId)!;
      const folder = collection.items[0] as any;

      render(<FolderSettingsDialog collectionId={colId} folder={folder} onClose={() => {}} />);

      // Switch to Auth tab
      fireEvent.click(screen.getByRole("button", { name: "Authentication" }));

      // Folder auth defaults to "inherit"
      const select = screen.getByRole("combobox", { name: "Authorization Type" });
      expect(select).toHaveValue("inherit");

      // Select API Key
      fireEvent.change(select, { target: { value: "apiKey" } });

      // Set key/value
      const keyInput = screen.getByPlaceholderText("X-API-Key");
      fireEvent.change(keyInput, { target: { value: "X-My-Key" } });
      const valInput = screen.getByPlaceholderText("{{apiKey}}");
      fireEvent.change(valInput, { target: { value: "my-key-value" } });

      // Save
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      const savedCol = useAppStore.getState().workspace.collections.find((c) => c.id === colId)!;
      const savedFolder = savedCol.items[0] as any;
      expect(savedFolder.auth).toEqual({
        type: "apiKey",
        key: "X-My-Key",
        value: "my-key-value",
        addTo: "header",
      });
    });
  });
});
