import type { DatasetParseResult, DatasetRow } from "./types";

/** A dataset larger than this is rejected before parsing — the Runner
 * re-executes the entire collection once per row, so an unbounded dataset
 * is a real "freeze the browser" risk, not just a memory nicety. See
 * docs/ARCHITECTURE.md's Milestone 8 section for the reasoning. */
export const MAX_DATASET_ROWS = 1000;

function stringifyCell(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Parses a JSON dataset: an array of flat objects. Columns are the union of
 * every row's keys (a row missing a key gets `""` for that column, not a
 * dropped column) — deliberately permissive about JSON shape since JSON
 * arrays commonly have optional fields, unlike CSV's fixed header row.
 */
export function parseJsonDataset(text: string): DatasetParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, detail: "Dataset file is not valid JSON." };
  }

  if (!Array.isArray(raw)) {
    return { ok: false, detail: "JSON dataset must be an array of objects (one object per iteration)." };
  }
  if (raw.length === 0) {
    return { ok: false, detail: "Dataset has no rows." };
  }
  if (raw.length > MAX_DATASET_ROWS) {
    return { ok: false, detail: `Dataset has ${raw.length} rows, which exceeds the ${MAX_DATASET_ROWS}-row limit.` };
  }
  if (!raw.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))) {
    return { ok: false, detail: "Every item in a JSON dataset must be a plain object." };
  }

  const objects = raw as Record<string, unknown>[];
  const columns = [...new Set(objects.flatMap((row) => Object.keys(row)))];
  const rows: DatasetRow[] = objects.map((row) => {
    const datasetRow: DatasetRow = {};
    for (const column of columns) {
      datasetRow[column] = stringifyCell(row[column]);
    }
    return datasetRow;
  });

  return { ok: true, data: { columns, rows } };
}

/**
 * Parses a simple CSV dataset: a header row followed by data rows,
 * comma-separated, no quoted-field escaping — a deliberate, documented
 * subset (not a full spreadsheet parser, per the milestone spec's own
 * instruction). Rejects duplicate headers, column-count mismatches, and an
 * empty header row, rather than guessing.
 */
export function parseCsvDataset(text: string): DatasetParseResult {
  const lines = text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { ok: false, detail: "CSV dataset is empty." };
  }

  const columns = lines[0]!.split(",").map((h) => h.trim());
  if (columns.some((c) => c === "")) {
    return { ok: false, detail: "CSV header row has an empty column name." };
  }
  const duplicates = columns.filter((c, i) => columns.indexOf(c) !== i);
  if (duplicates.length > 0) {
    return { ok: false, detail: `CSV header row has duplicate column(s): ${[...new Set(duplicates)].join(", ")}.` };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length === 0) {
    return { ok: false, detail: "Dataset has no rows." };
  }
  if (dataLines.length > MAX_DATASET_ROWS) {
    return { ok: false, detail: `Dataset has ${dataLines.length} rows, which exceeds the ${MAX_DATASET_ROWS}-row limit.` };
  }

  const rows: DatasetRow[] = [];
  for (let i = 0; i < dataLines.length; i++) {
    const cells = dataLines[i]!.split(",").map((c) => c.trim());
    if (cells.length !== columns.length) {
      return {
        ok: false,
        detail: `Row ${i + 2} has ${cells.length} column(s), expected ${columns.length}.`,
      };
    }
    const row: DatasetRow = {};
    columns.forEach((column, index) => {
      row[column] = cells[index]!;
    });
    rows.push(row);
  }

  return { ok: true, data: { columns, rows } };
}

export function detectDatasetFormat(filename: string, text: string): "json" | "csv" {
  if (filename.toLowerCase().endsWith(".json")) return "json";
  if (filename.toLowerCase().endsWith(".csv")) return "csv";
  const trimmed = text.trimStart();
  return trimmed.startsWith("[") || trimmed.startsWith("{") ? "json" : "csv";
}

export function parseDataset(filename: string, text: string): DatasetParseResult {
  const format = detectDatasetFormat(filename, text);
  return format === "json" ? parseJsonDataset(text) : parseCsvDataset(text);
}
