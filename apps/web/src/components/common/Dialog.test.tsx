import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
  it("renders role=\"dialog\" by default", () => {
    render(
      <Dialog onClose={vi.fn()} titleId="t" className="">
        <h2 id="t">Title</h2>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders role=\"alertdialog\" when explicitly requested", () => {
    render(
      <Dialog onClose={vi.fn()} titleId="t" className="" role="alertdialog">
        <h2 id="t">Confirm</h2>
      </Dialog>,
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
