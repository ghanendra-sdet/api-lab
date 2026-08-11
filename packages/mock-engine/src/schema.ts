import { z } from "zod";
import { HTTP_METHODS } from "@api-lab/shared";
import { MAX_DELAY_MS, MOCK_BODY_FORMATS } from "./types.ts";

const httpMethodSchema = z.enum([...HTTP_METHODS]);
const bodyFormatSchema = z.enum([...MOCK_BODY_FORMATS]);

const scenarioHeaderSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
});

export const mockScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.number().int().min(100).max(599),
  headers: z.array(scenarioHeaderSchema),
  bodyFormat: bodyFormatSchema,
  body: z.string(),
  delayMs: z.number().int().min(0).max(MAX_DELAY_MS),
  enabled: z.boolean(),
});

export const mockRouteSchema = z.object({
  id: z.string(),
  method: httpMethodSchema,
  path: z.string(),
  enabled: z.boolean(),
  scenarios: z.array(mockScenarioSchema).min(1),
  activeScenarioId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MOCK_ROUTES_FORMAT_VERSION = 1;

export const mockRoutesFileSchema = z.object({
  version: z.literal(MOCK_ROUTES_FORMAT_VERSION),
  routes: z.array(mockRouteSchema),
});

export type MockRoutesFile = z.infer<typeof mockRoutesFileSchema>;
