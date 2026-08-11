import { createExtractionId } from "./id.ts";
import type { Extraction, ExtractionSource } from "./types.ts";

export function createExtraction(source: ExtractionSource = "json"): Extraction {
  return {
    id: createExtractionId(),
    source,
    path: "",
    variable: "",
    enabled: true,
  };
}
