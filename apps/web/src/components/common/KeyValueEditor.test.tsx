import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KeyValueEditor } from "./KeyValueEditor";

describe("KeyValueEditor", () => {
  it("calls onAdd when the add-row button is clicked", () => {
    const onAdd = vi.fn();
    render(
      <KeyValueEditor label="Headers" rows={[]} onAdd={onAdd} onUpdate={() => {}} onRemove={() => {}} />,
    );
    fireEvent.click(screen.getByText("+ Add row"));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("calls onUpdate when a key input changes", () => {
    const onUpdate = vi.fn();
    render(
      <KeyValueEditor
        label="Headers"
        rows={[{ id: "row_1", key: "", value: "", enabled: true }]}
        onAdd={() => {}}
        onUpdate={onUpdate}
        onRemove={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "Authorization" } });
    expect(onUpdate).toHaveBeenCalledWith("row_1", { key: "Authorization" });
  });

  it("calls onRemove when a row's delete button is clicked", () => {
    const onRemove = vi.fn();
    render(
      <KeyValueEditor
        label="Headers"
        rows={[{ id: "row_1", key: "Accept", value: "application/json", enabled: true }]}
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText("Delete row Accept"));
    expect(onRemove).toHaveBeenCalledWith("row_1");
  });
});
