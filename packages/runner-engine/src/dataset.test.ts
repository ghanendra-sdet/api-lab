import { describe, expect, it } from "vitest";
import { detectDatasetFormat, MAX_DATASET_ROWS, parseCsvDataset, parseDataset, parseJsonDataset } from "./dataset.ts";

describe("parseJsonDataset", () => {
  it("parses a valid array of objects", () => {
    const result = parseJsonDataset(JSON.stringify([{ email: "a@x.com", name: "A" }, { email: "b@x.com", name: "B" }]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.columns.sort()).toEqual(["email", "name"]);
      expect(result.data.rows).toHaveLength(2);
      expect(result.data.rows[0]).toEqual({ email: "a@x.com", name: "A" });
    }
  });

  it("fills missing keys with an empty string rather than dropping the column", () => {
    const result = parseJsonDataset(JSON.stringify([{ a: "1", b: "2" }, { a: "3" }]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.rows[1]).toEqual({ a: "3", b: "" });
    }
  });

  it("stringifies non-string values", () => {
    const result = parseJsonDataset(JSON.stringify([{ id: 1, active: true }]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.rows[0]).toEqual({ id: "1", active: "true" });
    }
  });

  it("rejects invalid JSON", () => {
    expect(parseJsonDataset("{not json").ok).toBe(false);
  });

  it("rejects a non-array top level", () => {
    expect(parseJsonDataset(JSON.stringify({ a: 1 })).ok).toBe(false);
  });

  it("rejects an empty array", () => {
    const result = parseJsonDataset("[]");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/no rows/i);
  });

  it("rejects an array containing a non-object", () => {
    expect(parseJsonDataset(JSON.stringify([{ a: 1 }, "not an object"])).ok).toBe(false);
  });

  it("rejects a dataset over the row limit", () => {
    const rows = Array.from({ length: MAX_DATASET_ROWS + 1 }, (_, i) => ({ id: i }));
    const result = parseJsonDataset(JSON.stringify(rows));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/exceeds/i);
  });
});

describe("parseCsvDataset", () => {
  it("parses a simple CSV", () => {
    const result = parseCsvDataset("email,name\na@x.com,A\nb@x.com,B");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.columns).toEqual(["email", "name"]);
      expect(result.data.rows).toEqual([
        { email: "a@x.com", name: "A" },
        { email: "b@x.com", name: "B" },
      ]);
    }
  });

  it("rejects duplicate headers", () => {
    const result = parseCsvDataset("email,email\na@x.com,b@x.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/duplicate/i);
  });

  it("rejects a row with the wrong column count", () => {
    const result = parseCsvDataset("email,name\na@x.com,A,extra");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/Row 2/);
  });

  it("rejects a header-only CSV (no data rows)", () => {
    const result = parseCsvDataset("email,name");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/no rows/i);
  });

  it("rejects an empty file", () => {
    expect(parseCsvDataset("").ok).toBe(false);
  });

  it("allows empty cell values", () => {
    const result = parseCsvDataset("email,name\na@x.com,");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.rows[0]!.name).toBe("");
  });

  it("rejects a dataset over the row limit", () => {
    const rows = Array.from({ length: MAX_DATASET_ROWS + 1 }, (_, i) => `user${i}@x.com`).join("\n");
    const result = parseCsvDataset(`email\n${rows}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/exceeds/i);
  });
});

describe("detectDatasetFormat / parseDataset", () => {
  it("detects JSON by extension", () => {
    expect(detectDatasetFormat("data.json", "[]")).toBe("json");
  });

  it("detects CSV by extension", () => {
    expect(detectDatasetFormat("data.csv", "a,b")).toBe("csv");
  });

  it("falls back to content sniffing for an unrecognized extension", () => {
    expect(detectDatasetFormat("data.txt", "[1,2,3]")).toBe("json");
    expect(detectDatasetFormat("data.txt", "a,b\n1,2")).toBe("csv");
  });

  it("parseDataset routes to the correct parser", () => {
    const jsonResult = parseDataset("d.json", JSON.stringify([{ a: "1" }]));
    expect(jsonResult.ok).toBe(true);
    const csvResult = parseDataset("d.csv", "a\n1");
    expect(csvResult.ok).toBe(true);
  });
});
