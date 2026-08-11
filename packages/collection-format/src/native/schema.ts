import { z } from "zod";
import { authConfigSchema } from "@api-lab/auth-engine";
import { assertionSchema } from "@api-lab/test-engine";
import { HTTP_METHODS, BODY_MODES, BODY_RAW_FORMATS } from "@api-lab/shared";

const httpMethodSchema = z.enum([...HTTP_METHODS]);
const bodyModeSchema = z.enum([...BODY_MODES]);
const bodyRawFormatSchema = z.enum([...BODY_RAW_FORMATS]);

const keyValueRowSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  description: z.string().optional(),
  enabled: z.boolean(),
});

const requestConfigSchema = z.object({
  method: httpMethodSchema,
  url: z.string(),
  params: z.array(keyValueRowSchema),
  headers: z.array(keyValueRowSchema),
  auth: authConfigSchema.default({ type: "none" }),
  bodyMode: bodyModeSchema,
  bodyRawFormat: bodyRawFormatSchema,
  bodyRawContent: z.string(),
  tests: z.array(assertionSchema).default([]),
});

const savedRequestSchema = z.object({
  id: z.string(),
  type: z.literal("request"),
  name: z.string(),
  request: requestConfigSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const folderSchema = z.object({
  id: z.string(),
  type: z.literal("folder"),
  name: z.string(),
  items: z.array(savedRequestSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  items: z.array(z.union([savedRequestSchema, folderSchema])),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const variableSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
  secret: z.boolean(),
});

const environmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  variables: z.array(variableSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const NATIVE_FORMAT_VERSION = 1;

export const nativeExportSchema = z.object({
  format: z.literal("api-lab"),
  version: z.literal(NATIVE_FORMAT_VERSION),
  workspace: z.object({ collections: z.array(collectionSchema) }),
  environments: z.object({
    environments: z.array(environmentSchema),
    activeEnvironmentId: z.string().nullable(),
  }),
});

export type NativeExport = z.infer<typeof nativeExportSchema>;
