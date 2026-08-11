import { z } from "zod";

/**
 * A validated, structurally-typed subset of OpenAPI 3.0.x / 3.1.x
 * (https://spec.openapis.org/oas/v3.1.0, https://spec.openapis.org/oas/v3.0.3).
 * Covers info/servers/paths/operations/parameters/requestBody/security —
 * the fields listed in the milestone spec — not the full spec (callbacks,
 * links, full JSON Schema composition, etc. are out of scope; unsupported
 * operation-level details are ignored rather than causing a parse failure).
 */

const serverSchema = z.object({ url: z.string() });

const parameterSchema = z.object({
  name: z.string(),
  in: z.enum(["path", "query", "header", "cookie"]),
  required: z.boolean().optional(),
  description: z.string().optional(),
  schema: z.record(z.unknown()).optional(),
  example: z.unknown().optional(),
});

const mediaTypeSchema = z.object({
  schema: z.record(z.unknown()).optional(),
  example: z.unknown().optional(),
  examples: z.record(z.object({ value: z.unknown().optional() })).optional(),
});

const requestBodySchema = z.object({
  description: z.string().optional(),
  required: z.boolean().optional(),
  content: z.record(mediaTypeSchema).optional(),
});

const operationSchema = z.object({
  summary: z.string().optional(),
  description: z.string().optional(),
  operationId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  parameters: z.array(parameterSchema).optional(),
  requestBody: requestBodySchema.optional(),
  security: z.array(z.record(z.array(z.string()))).optional(),
});

const HTTP_METHOD_KEYS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;

const pathItemSchema = z
  .object({
    parameters: z.array(parameterSchema).optional(),
  })
  .and(z.record(z.unknown()));

const securitySchemeSchema = z.object({
  type: z.string(),
  scheme: z.string().optional(),
  in: z.string().optional(),
  name: z.string().optional(),
});

export const openApiDocumentSchema = z.object({
  openapi: z.string(),
  info: z.object({ title: z.string(), description: z.string().optional() }),
  servers: z.array(serverSchema).optional(),
  paths: z.record(pathItemSchema).optional().default({}),
  components: z
    .object({
      securitySchemes: z.record(securitySchemeSchema).optional(),
    })
    .optional(),
  security: z.array(z.record(z.array(z.string()))).optional(),
});

export type OpenApiDocument = z.infer<typeof openApiDocumentSchema>;
export type OpenApiOperation = z.infer<typeof operationSchema>;
export type OpenApiParameter = z.infer<typeof parameterSchema>;
export type OpenApiSecurityScheme = z.infer<typeof securitySchemeSchema>;

export { operationSchema, HTTP_METHOD_KEYS };
