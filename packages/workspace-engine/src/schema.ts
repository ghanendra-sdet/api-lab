import { z } from "zod";
import { BODY_MODES, BODY_RAW_FORMATS, HTTP_METHODS } from "@api-lab/shared";
import { authConfigSchema } from "@api-lab/auth-engine";
import { assertionSchema } from "@api-lab/test-engine";
import { extractionSchema } from "@api-lab/runner-engine";
import type { CollectionItem, Folder } from "./types.ts";

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

// Folders nest arbitrarily deep as of Phase 2 of Workspace Management, so
// `folderSchema` and `collectionItemSchema` are mutually recursive — `z.lazy`
// defers evaluation until parse time, the standard zod pattern for this.
// A pre-Phase-2 flat folder (items: SavedRequest[] only) still parses fine:
// it is simply a folder whose `items` array happens to contain zero nested
// folders, nothing about the old shape needs a migration.
// The explicit third generic (`unknown`) is the schema's *input* type —
// left loose rather than exactly `CollectionItem`/`Folder` because several
// fields use zod `.default(...)` (e.g. `variables`, `auth`), whose *input*
// type allows `undefined` while the *output* type (after defaulting) does
// not. Only the output type needs to match the real domain type; every
// caller here only ever consumes `.safeParse(...).data`, never the raw
// input shape.
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
    variables: z.array(variableSchema).default([]),
    auth: authConfigSchema.default({ type: "inherit" }),
  }),
);

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

const workspaceMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const workspaceRegistrySchema = z.object({
  workspaces: z.array(workspaceMetaSchema),
  activeWorkspaceId: z.string(),
});
