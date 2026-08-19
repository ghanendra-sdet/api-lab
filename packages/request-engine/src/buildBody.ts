import type { BodyMode, BodyRawFormat, FormDataField, UrlencodedField } from "@api-lab/shared";

const RAW_FORMAT_CONTENT_TYPE: Record<BodyRawFormat, string> = {
  JSON: "application/json",
  Text: "text/plain",
  XML: "application/xml",
  HTML: "text/html",
};

export interface BuiltBody {
  body: string | FormData | undefined;
  /** Content-Type this body mode implies, or undefined if it doesn't imply one. */
  contentType: string | undefined;
}

export function compileFormBody(fields: FormDataField[]): FormData {
  const fd = new FormData();
  for (const field of fields) {
    if (field.enabled === false) continue;
    if (field.type === "text") {
      fd.append(field.key, field.value);
    } else if (field.type === "file") {
      const blobValue = field.file.reference || field.file.path || field.file.name || "";
      const blob = new Blob([blobValue], {
        type: field.file.mimeType || "application/octet-stream",
      });
      fd.append(field.key, blob, field.file.name);
    }
  }
  return fd;
}

export function compileUrlencodedBody(fields: UrlencodedField[]): string {
  const params = new URLSearchParams();
  for (const field of fields) {
    if (field.enabled === false) continue;
    params.append(field.key, field.value);
  }
  return params.toString();
}

/**
 * Milestone 2 supports "none" and "raw" (JSON/Text/XML/HTML) bodies only.
 * form-data and x-www-form-urlencoded support is implemented in Milestone D.2.
 */
export function buildBody(
  bodyMode: BodyMode,
  bodyRawFormat: BodyRawFormat,
  bodyRawContent: string,
): BuiltBody {
  if (bodyMode === "raw" && bodyRawContent.trim() !== "") {
    return { body: bodyRawContent, contentType: RAW_FORMAT_CONTENT_TYPE[bodyRawFormat] };
  }
  if (bodyMode === "form-data") {
    const content = bodyRawContent.trim();
    if (content === "") {
      return { body: undefined, contentType: undefined };
    }
    try {
      const fields = JSON.parse(content) as FormDataField[];
      const body = compileFormBody(fields);
      return { body, contentType: undefined };
    } catch {
      return { body: undefined, contentType: undefined };
    }
  }
  if (bodyMode === "x-www-form-urlencoded") {
    const content = bodyRawContent.trim();
    if (content === "") {
      return { body: undefined, contentType: undefined };
    }
    try {
      const fields = JSON.parse(content) as UrlencodedField[];
      const body = compileUrlencodedBody(fields);
      return { body, contentType: "application/x-www-form-urlencoded" };
    } catch {
      return { body: undefined, contentType: undefined };
    }
  }
  return { body: undefined, contentType: undefined };
}

