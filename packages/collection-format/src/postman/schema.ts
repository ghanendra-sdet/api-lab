import { z } from "zod";

/**
 * A validated, structurally-typed subset of the Postman Collection v2.1
 * schema (https://schema.postman.com/json/collection/v2.1.0/collection.json)
 * and Postman Environment format. Deliberately loose at the leaves
 * (`z.record(z.unknown())`/`.passthrough()`) rather than modeling every
 * documented Postman auth/body/script variant exhaustively — the adapter
 * layer defensively reads only the fields it knows how to map, and an
 * unrecognized shape at a leaf produces a warning, not a validation
 * failure for the whole file. The top-level shape (info + item[]) *is*
 * strictly required, since that's the unambiguous structural contract.
 */

const keyValueSchema = z.object({
  key: z.string().optional(),
  value: z.unknown().optional(),
  disabled: z.boolean().optional(),
  type: z.string().optional(),
  description: z.unknown().optional(),
});

const authParamSchema = z.object({
  key: z.string(),
  value: z.unknown().optional(),
  type: z.string().optional(),
});

const postmanAuthSchema = z
  .object({
    type: z.string(),
    apikey: z.array(authParamSchema).optional(),
    basic: z.array(authParamSchema).optional(),
    bearer: z.array(authParamSchema).optional(),
  })
  .passthrough();

const postmanUrlSchema = z.union([
  z.string(),
  z.object({
    raw: z.string().optional(),
    host: z.union([z.array(z.string()), z.string()]).optional(),
    path: z.union([z.array(z.string()), z.string()]).optional(),
    query: z.array(keyValueSchema).optional(),
  }),
]);

const postmanBodySchema = z.object({
  mode: z.string().optional(),
  raw: z.string().optional(),
  options: z.object({ raw: z.object({ language: z.string().optional() }).optional() }).optional(),
  urlencoded: z.array(keyValueSchema).optional(),
  formdata: z.array(keyValueSchema).optional(),
});

const postmanRequestSchema = z.object({
  method: z.string().optional(),
  header: z.array(keyValueSchema).optional(),
  body: postmanBodySchema.optional(),
  url: postmanUrlSchema.optional(),
  auth: postmanAuthSchema.optional(),
  description: z.unknown().optional(),
});

const postmanScriptEventSchema = z.object({
  listen: z.string().optional(),
  script: z.object({ exec: z.union([z.array(z.string()), z.string()]).optional() }).optional(),
});

export interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: z.infer<typeof postmanRequestSchema>;
  event?: z.infer<typeof postmanScriptEventSchema>[];
  description?: unknown;
}

const postmanItemSchema: z.ZodType<PostmanItem> = z.lazy(() =>
  z.object({
    name: z.string().optional(),
    item: z.array(postmanItemSchema).optional(),
    request: postmanRequestSchema.optional(),
    event: z.array(postmanScriptEventSchema).optional(),
    description: z.unknown().optional(),
  }),
);

export const postmanCollectionSchema = z.object({
  info: z.object({
    name: z.string(),
    schema: z.string().optional(),
    _postman_id: z.string().optional(),
    description: z.unknown().optional(),
  }),
  item: z.array(postmanItemSchema),
  auth: postmanAuthSchema.optional(),
  variable: z.array(keyValueSchema).optional(),
  event: z.array(postmanScriptEventSchema).optional(),
});

export type PostmanCollection = z.infer<typeof postmanCollectionSchema>;
export type PostmanRequest = z.infer<typeof postmanRequestSchema>;
export type PostmanUrl = z.infer<typeof postmanUrlSchema>;
export type PostmanBody = z.infer<typeof postmanBodySchema>;
export type PostmanAuth = z.infer<typeof postmanAuthSchema>;

export const postmanEnvironmentSchema = z.object({
  name: z.string().optional(),
  values: z.array(
    z.object({
      key: z.string(),
      value: z.unknown().optional(),
      enabled: z.boolean().optional(),
      type: z.string().optional(),
    }),
  ),
});

export type PostmanEnvironment = z.infer<typeof postmanEnvironmentSchema>;
