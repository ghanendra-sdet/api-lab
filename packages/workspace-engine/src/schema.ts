import { z } from "zod";
import { AUTH_TYPES, BODY_MODES, BODY_RAW_FORMATS, HTTP_METHODS } from "@api-lab/shared";

const httpMethodSchema = z.enum([...HTTP_METHODS]);
const authTypeSchema = z.enum([...AUTH_TYPES]);
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
  authType: authTypeSchema,
  bodyMode: bodyModeSchema,
  bodyRawFormat: bodyRawFormatSchema,
  bodyRawContent: z.string(),
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

const collectionItemSchema = z.union([savedRequestSchema, folderSchema]);

const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  items: z.array(collectionItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const workspaceSchema = z.object({
  collections: z.array(collectionSchema),
});
