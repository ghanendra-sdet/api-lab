import { z } from "zod";

const noAuthSchema = z.object({ type: z.literal("none") });
const inheritAuthSchema = z.object({ type: z.literal("inherit") });
const apiKeySchema = z.object({
  type: z.literal("apiKey"),
  key: z.string(),
  value: z.string(),
  addTo: z.enum(["header", "query"]),
});
const basicSchema = z.object({ type: z.literal("basic"), username: z.string(), password: z.string() });
const bearerSchema = z.object({ type: z.literal("bearer"), token: z.string() });
const jwtSchema = z.object({ type: z.literal("jwt"), token: z.string() });
const oauth2Schema = z.object({ type: z.literal("oauth2") });

export const authConfigSchema = z.discriminatedUnion("type", [
  noAuthSchema,
  inheritAuthSchema,
  apiKeySchema,
  basicSchema,
  bearerSchema,
  jwtSchema,
  oauth2Schema,
]);
