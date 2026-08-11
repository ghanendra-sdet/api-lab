import { z } from "zod";
import { EXTRACTION_SOURCES } from "./types";

export const extractionSchema = z.object({
  id: z.string(),
  source: z.enum(EXTRACTION_SOURCES),
  path: z.string(),
  variable: z.string(),
  enabled: z.boolean(),
});
