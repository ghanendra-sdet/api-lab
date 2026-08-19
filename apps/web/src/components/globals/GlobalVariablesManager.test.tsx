import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalVariablesManager } from "./GlobalVariablesManager";
import { useAppStore } from "../../store/useAppStore";

function resetStore() {
  useAppStore.setState({
    globals: [],
    globalsLoadError: null,
  });
}

describe("GlobalVariablesManager", () => {
  beforeEach(() => {
    resetStore();
  });

  it("adds a global variable via the store when clicking Add variable", () => {
    render(<GlobalVariablesManager onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add variable" }));
    expect(useAppStore.getState().globals).toHaveLength(1);
  });

  it("updates a global variable's key through the editor input", () => {
    const { addGlobalVariable } = useAppStore.getState();
    const id = addGlobalVariable();
    render(<GlobalVariablesManager onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "API_HOST" } });
    expect(useAppStore.getState().globals.find((v) => v.id === id)?.key).toBe("API_HOST");
  });

  it("removes a global variable when the delete button is clicked", () => {
    const { addGlobalVariable } = useAppStore.getState();
    addGlobalVariable();
    render(<GlobalVariablesManager onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Delete variable/));
    expect(useAppStore.getState().globals).toHaveLength(0);
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<GlobalVariablesManager onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close global variables manager"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the load-error banner and resets on confirmation", () => {
    useAppStore.setState({ globalsLoadError: "Malformed JSON" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GlobalVariablesManager onClose={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Malformed JSON");
    fireEvent.click(screen.getByRole("button", { name: "Reset Local Global Variables" }));
    expect(useAppStore.getState().globalsLoadError).toBeNull();
    confirmSpy.mockRestore();
  });
});
