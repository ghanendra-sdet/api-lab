import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MethodSelector } from "./MethodSelector";

describe("MethodSelector", () => {
  it("renders the current method and calls onChange when a new one is selected", () => {
    const onChange = vi.fn();
    render(<MethodSelector value="GET" onChange={onChange} />);

    const select = screen.getByLabelText("HTTP method") as HTMLSelectElement;
    expect(select.value).toBe("GET");

    fireEvent.change(select, { target: { value: "POST" } });
    expect(onChange).toHaveBeenCalledWith("POST");
  });

  it("lists all seven HTTP methods", () => {
    render(<MethodSelector value="GET" onChange={() => {}} />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
  });
});
