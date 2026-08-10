import { describe, expect, it } from "vitest";
import { formatDuration, formatSize, statusColorClass } from "./format";

describe("formatDuration", () => {
  it("shows milliseconds under 1 second", () => {
    expect(formatDuration(142)).toBe("142 ms");
  });

  it("shows seconds at or above 1000ms", () => {
    expect(formatDuration(1500)).toBe("1.50 s");
  });
});

describe("formatSize", () => {
  it("returns an em dash for null (unknown) size", () => {
    expect(formatSize(null)).toBe("—");
  });

  it("shows bytes under 1KB", () => {
    expect(formatSize(512)).toBe("512 B");
  });

  it("shows kilobytes under 1MB", () => {
    expect(formatSize(2048)).toBe("2.00 KB");
  });

  it("shows megabytes at or above 1MB", () => {
    expect(formatSize(5 * 1024 * 1024)).toBe("5.00 MB");
  });
});

describe("statusColorClass", () => {
  it("returns the error color for a null status", () => {
    expect(statusColorClass(null, false)).toContain("red");
  });

  it("distinguishes 2xx from 4xx and 5xx", () => {
    expect(statusColorClass(200, true)).not.toBe(statusColorClass(404, false));
    expect(statusColorClass(404, false)).not.toBe(statusColorClass(500, false));
  });
});
