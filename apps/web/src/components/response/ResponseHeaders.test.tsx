import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResponseHeaders } from "./ResponseHeaders";

describe("ResponseHeaders", () => {
  it("shows an empty state with no headers", () => {
    render(<ResponseHeaders headers={{}} />);
    expect(screen.getByText("No response headers.")).toBeInTheDocument();
  });

  it("renders each header key and value", () => {
    render(<ResponseHeaders headers={{ "content-type": "application/json", "x-request-id": "abc" }} />);
    expect(screen.getByText("content-type")).toBeInTheDocument();
    expect(screen.getByText("application/json")).toBeInTheDocument();
    expect(screen.getByText("x-request-id")).toBeInTheDocument();
    expect(screen.getByText("abc")).toBeInTheDocument();
  });
});
