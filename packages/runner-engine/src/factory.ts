import { createExtractionId } from "./id";
import type { Extraction, ExtractionSource } from "./types";

export function createExtraction(source: ExtractionSource = "json"): Extraction {
  return {
    id: createExtractionId(),
    source,
    path: "",
    variable: "",
    enabled: true,
  };
}
