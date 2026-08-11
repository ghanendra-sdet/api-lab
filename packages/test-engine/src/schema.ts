import { z } from "zod";
import { ASSERTION_OPERATORS, ASSERTION_TARGETS } from "./types.ts";

export const assertionSchema = z.object({
  id: z.string(),
  target: z.enum([...ASSERTION_TARGETS]),
  operator: z.enum([...ASSERTION_OPERATORS]),
  key: z.string().optional(),
  expected: z.string(),
  enabled: z.boolean(),
});
