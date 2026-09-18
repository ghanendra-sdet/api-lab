import { z } from "zod";
import { authConfigSchema } from "@api-lab/auth-engine";
import { assertionSchema } from "@api-lab/test-engine";
import { extractionSchema } from "@api-lab/runner-engine";
import { HTTP_METHODS, BODY_MODES, BODY_RAW_FORMATS } from "@api-lab/shared";
import type { CollectionItem, Folder } from "@api-lab/workspace-engine";

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

const variableSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
  secret: z.boolean(),
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
  extractions: z.array(extractionSchema).default([]),
  preRequestScript: z.string().optional(),
  postResponseScript: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  variables: z.array(variableSchema).optional(),
});

const savedRequestSchema = z.object({
  id: z.string(),
  type: z.literal("request"),
  name: z.string(),
  request: requestConfigSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Folders nest arbitrarily deep as of Phase 2 of Workspace Management —
// mutually recursive via z.lazy, same pattern as workspace-engine's own
// schema.ts (this file mirrors that package's schema for native export/
// import round-tripping, see the file-level docstring below).
// See workspace-engine's schema.ts for why the input generic is loosened to
// `unknown` here (zod `.optional()`/`.default()` fields' input type allows
// `undefined`, which the real domain types don't) — this file mirrors that
// package's schema for native export/import round-tripping.
const collectionItemSchema: z.ZodType<CollectionItem, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([savedRequestSchema, folderSchema]),
);

const folderSchema: z.ZodType<Folder, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.literal("folder"),
    name: z.string(),
    items: z.array(collectionItemSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
    variables: z.array(variableSchema).optional(),
    auth: authConfigSchema.optional(),
  }),
);

const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  items: z.array(collectionItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  variables: z.array(variableSchema).optional(),
  auth: authConfigSchema.optional(),
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
