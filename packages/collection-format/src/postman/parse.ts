import { postmanCollectionSchema, postmanEnvironmentSchema, type PostmanCollection, type PostmanEnvironment } from "./schema";

export type PostmanParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; detail: string };

export function parsePostmanCollection(raw: unknown): PostmanParseResult<PostmanCollection> {
  const parsed = postmanCollectionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, detail: `Not a recognizable Postman Collection: ${parsed.error.issues[0]?.message ?? "invalid shape"}.` };
  }
  return { ok: true, data: parsed.data };
}

export function parsePostmanEnvironment(raw: unknown): PostmanParseResult<PostmanEnvironment> {
  const parsed = postmanEnvironmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, detail: `Not a recognizable Postman Environment: ${parsed.error.issues[0]?.message ?? "invalid shape"}.` };
  }
  return { ok: true, data: parsed.data };
}
