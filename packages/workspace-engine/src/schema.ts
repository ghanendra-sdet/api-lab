import { z } from "zod";
import { BODY_MODES, BODY_RAW_FORMATS, HTTP_METHODS } from "@api-lab/shared";
import { authConfigSchema } from "@api-lab/auth-engine";
import { assertionSchema } from "@api-lab/test-engine";
import { extractionSchema } from "@api-lab/runner-engine";

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
  // Backward compatibility (Milestone 5): requests saved before this
  // milestone have no `auth` field (only the old cosmetic `authType`
  // string, which is simply dropped here — zod strips unrecognized keys by
  // default). Since no real credentials were ever stored under the old
  // field, the only safe reconstruction is "No Auth" — see types.ts.
  auth: authConfigSchema.default({ type: "none" }),
  bodyMode: bodyModeSchema,
  bodyRawFormat: bodyRawFormatSchema,
  bodyRawContent: z.string(),
  // Backward compatibility (Milestone 7): requests saved before this
  // milestone have no `tests` field at all — default to no assertions.
  tests: z.array(assertionSchema).default([]),
  // Backward compatibility (Milestone 8): requests saved before this
  // milestone have no `extractions` field at all — default to none.
  extractions: z.array(extractionSchema).default([]),
  preRequestScript: z.string().optional(),
  postResponseScript: z.string().optional(),
  // Backward compatibility (Milestone B3.1): requests saved before this
  // milestone have no `dependsOn` field at all — left undefined on load.
  dependsOn: z.array(z.string()).optional(),
  variables: z.array(variableSchema).default([]),
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
  variables: z.array(variableSchema).default([]),
  auth: authConfigSchema.default({ type: "inherit" }),
});

const collectionItemSchema = z.union([savedRequestSchema, folderSchema]);

const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  items: z.array(collectionItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  variables: z.array(variableSchema).default([]),
  auth: authConfigSchema.default({ type: "none" }),
});

export const workspaceSchema = z.object({
  collections: z.array(collectionSchema),
});
