import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { BodyPanel } from "./BodyPanel";
import { createEmptyTab } from "../../lib/seedData";

function resetStoreWithTab(overrides = {}) {
  const tab = createEmptyTab(overrides);
  useAppStore.setState({
    tabs: [tab],
    activeTabId: tab.id,
  });
  return tab.id;
}

describe("BodyPanel Integration", () => {
  it("renders body mode selector options and lets user select them", () => {
    const tabId = resetStoreWithTab({ bodyMode: "none" });
    const tab = useAppStore.getState().tabs.find((t) => t.id === tabId)!;
    render(<BodyPanel tab={tab} />);

    // Verify radio options exist
    const noneRadio = screen.getByLabelText("none");
    const formDataRadio = screen.getByLabelText("form-data");
    const urlencodedRadio = screen.getByLabelText("x-www-form-urlencoded");
    const rawRadio = screen.getByLabelText("raw");

    expect(noneRadio).toBeInTheDocument();
    expect(noneRadio).toBeChecked();
    expect(formDataRadio).toBeInTheDocument();
    expect(formDataRadio).not.toBeChecked();
    expect(urlencodedRadio).toBeInTheDocument();
    expect(rawRadio).toBeInTheDocument();

    // Select form-data
    fireEvent.click(formDataRadio);
    expect(useAppStore.getState().tabs.find((t) => t.id === tabId)!.bodyMode).toBe("form-data");
  });

  describe("Form-Data Editor", () => {
    it("renders rows and supports adding, updating, type-toggling, and removing rows", () => {
      const tabId = resetStoreWithTab({
        bodyMode: "form-data",
        bodyFormData: [
          { id: "row-1", type: "text", key: "username", value: "alice", enabled: true },
        ],
      });
      const tab = useAppStore.getState().tabs.find((t) => t.id === tabId)!;
      render(<BodyPanel tab={tab} />);

      // Verify row is rendered
      expect(screen.getByDisplayValue("username")).toBeInTheDocument();
      expect(screen.getByDisplayValue("alice")).toBeInTheDocument();

      // Add a row
      fireEvent.click(screen.getByRole("button", { name: "+ Add row" }));
      expect(useAppStore.getState().tabs.find((t) => t.id === tabId)!.bodyFormData).toHaveLength(2);

      // Edit Key of the first row
      const keyInput = screen.getAllByPlaceholderText("key")[0]!;
      fireEvent.change(keyInput, { target: { value: "user_name_changed" } });
      const currentFields = useAppStore.getState().tabs.find((t) => t.id === tabId)!.bodyFormData || [];
      expect(currentFields[0]?.key).toBe("user_name_changed");

      // Edit Value of the first row
      const valInput = screen.getAllByPlaceholderText("value")[0]!;
      fireEvent.change(valInput, { target: { value: "bob" } });
      const fieldsAfterUpdate = useAppStore.getState().tabs.find((t) => t.id === tabId)!.bodyFormData || [];
      const firstRow = fieldsAfterUpdate[0]!;
      expect(firstRow.type).toBe("text");
      if (firstRow.type === "text") {
        expect(firstRow.value).toBe("bob");
      }

      // Toggle Type to File
      const typeSelect = screen.getAllByLabelText("Field Type")[0]!;
      fireEvent.change(typeSelect, { target: { value: "file" } });
      const fieldsAfterToggle = useAppStore.getState().tabs.find((t) => t.id === tabId)!.bodyFormData || [];
      const updatedRow = fieldsAfterToggle[0]!;
      expect(updatedRow.type).toBe("file");
      if (updatedRow.type === "file") {
        expect(updatedRow.file).toEqual({ name: "", reference: "" });
      }

      // Remove the row
      const deleteButtons = screen.getAllByLabelText(/Delete row/);
      fireEvent.click(deleteButtons[0]!);
      expect(useAppStore.getState().tabs.find((t) => t.id === tabId)!.bodyFormData).toHaveLength(1);
    });

    it("verifies file fields accept file name and reference metadata", () => {
      const tabId = resetStoreWithTab({
        bodyMode: "form-data",
        bodyFormData: [
          { id: "row-1", type: "file", key: "photo", file: { name: "avatar.jpg", reference: "ref-999" }, enabled: true },
        ],
      });
      const tab = useAppStore.getState().tabs.find((t) => t.id === tabId)!;
      render(<BodyPanel tab={tab} />);

      expect(screen.getByDisplayValue("photo")).toBeInTheDocument();
      expect(screen.getByDisplayValue("avatar.jpg")).toBeInTheDocument();
      expect(screen.getByDisplayValue("ref-999")).toBeInTheDocument();

      // Edit File Name
      const fileNameInput = screen.getByPlaceholderText("file name");
      fireEvent.change(fileNameInput, { target: { value: "profile.png" } });
      const currentFields = useAppStore.getState().tabs.find((t) => t.id === tabId)!.bodyFormData || [];
      const updatedRow = currentFields[0]!;
      expect(updatedRow.type).toBe("file");
      if (updatedRow.type === "file") {
        expect(updatedRow.file.name).toBe("profile.png");
      }
    });
  });

  describe("URL-Encoded Editor", () => {
    it("renders rows and supports adding, updating, and removing rows", () => {
      const tabId = resetStoreWithTab({
        bodyMode: "x-www-form-urlencoded",
        bodyUrlencoded: [
          { id: "row-1", key: "grant_type", value: "password", enabled: true },
        ],
      });
      const tab = useAppStore.getState().tabs.find((t) => t.id === tabId)!;
      render(<BodyPanel tab={tab} />);

      // Verify row is rendered
      expect(screen.getByDisplayValue("grant_type")).toBeInTheDocument();
      expect(screen.getByDisplayValue("password")).toBeInTheDocument();

      // Add a row
      fireEvent.click(screen.getByRole("button", { name: "+ Add row" }));
      expect(useAppStore.getState().tabs.find((t) => t.id === tabId)!.bodyUrlencoded).toHaveLength(2);

      // Edit Key of the first row
      const keyInput = screen.getAllByPlaceholderText("key")[0]!;
      fireEvent.change(keyInput, { target: { value: "scope" } });
      const currentFields = useAppStore.getState().tabs.find((t) => t.id === tabId)!.bodyUrlencoded || [];
      expect(currentFields[0]?.key).toBe("scope");

      // Edit Value of the first row
      const valInput = screen.getAllByPlaceholderText("value")[0]!;
      fireEvent.change(valInput, { target: { value: "read" } });
      const fieldsAfterUpdate = useAppStore.getState().tabs.find((t) => t.id === tabId)!.bodyUrlencoded || [];
      expect(fieldsAfterUpdate[0]?.value).toBe("read");

      // Remove the row
      const deleteButtons = screen.getAllByLabelText(/Delete row/);
      fireEvent.click(deleteButtons[0]!);
      expect(useAppStore.getState().tabs.find((t) => t.id === tabId)!.bodyUrlencoded).toHaveLength(1);
    });
  });

  describe("Variables Expression UI Binding", () => {
    it("preserves literal variable templates like {{token}} in text inputs", () => {
      resetStoreWithTab({
        bodyMode: "x-www-form-urlencoded",
        bodyUrlencoded: [
          { id: "row-1", key: "user_{{id}}", value: "{{token}}", enabled: true },
        ],
      });
      const activeTabId = useAppStore.getState().activeTabId;
      const tab = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!;
      render(<BodyPanel tab={tab} />);

      expect(screen.getByDisplayValue("user_{{id}}")).toBeInTheDocument();
      expect(screen.getByDisplayValue("{{token}}")).toBeInTheDocument();
    });
  });
});
