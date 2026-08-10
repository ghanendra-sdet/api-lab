import type { HttpMethod } from "@api-lab/shared";

const METHOD_TEXT_CLASS: Record<HttpMethod, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  PUT: "text-method-put",
  PATCH: "text-method-patch",
  DELETE: "text-method-delete",
  HEAD: "text-method-head",
  OPTIONS: "text-method-options",
};

export function methodTextClass(method: HttpMethod): string {
  return METHOD_TEXT_CLASS[method];
}
