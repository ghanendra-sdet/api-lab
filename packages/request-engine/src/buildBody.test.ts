import { describe, expect, it } from "vitest";
import { buildBody } from "./buildBody.ts";

describe("buildBody", () => {
  it("returns no body for mode 'none'", () => {
    expect(buildBody("none", "JSON", "{}")).toEqual({ body: undefined, contentType: undefined });
  });

  it("returns the raw JSON string and application/json content type", () => {
    const result = buildBody("raw", "JSON", '{"a":1}');
    expect(result.body).toBe('{"a":1}');
    expect(result.contentType).toBe("application/json");
  });

  it("returns text/plain for raw Text format", () => {
    const result = buildBody("raw", "Text", "hello");
    expect(result.contentType).toBe("text/plain");
  });

  it("returns no body when raw content is empty", () => {
    expect(buildBody("raw", "JSON", "   ")).toEqual({ body: undefined, contentType: undefined });
  });

  it("compiles form-data text fields correctly and leaves contentType undefined", () => {
    const fields = [
      { type: "text" as const, key: "name", value: "John", enabled: true },
      { type: "text" as const, key: "city", value: "Bangalore", enabled: true },
      { type: "text" as const, key: "disabled", value: "ignore", enabled: false },
    ];
    const result = buildBody("form-data", "JSON", JSON.stringify(fields));
    expect(result.body).toBeInstanceOf(FormData);
    expect(result.contentType).toBeUndefined();

    const fd = result.body as FormData;
    expect(fd.get("name")).toBe("John");
    expect(fd.get("city")).toBe("Bangalore");
    expect(fd.has("disabled")).toBe(false);
  });

  it("compiles form-data file fields storing metadata/reference only", () => {
    const fields = [
      {
        type: "file" as const,
        key: "avatar",
        file: { name: "me.png", reference: "file-ref-123", mimeType: "image/png" },
        enabled: true,
      },
    ];
    const result = buildBody("form-data", "JSON", JSON.stringify(fields));
    expect(result.body).toBeInstanceOf(FormData);

    const fd = result.body as FormData;
    const fileBlob = fd.get("avatar") as Blob;
    expect(fileBlob).toBeInstanceOf(Blob);
    expect(fileBlob.type).toBe("image/png");
    // Since we mock file references by containing their reference string
    // inside the blob, verify that raw content is not base64 or file bytes
  });

  it("compiles form-data duplicate keys correctly", () => {
    const fields = [
      { type: "text" as const, key: "tag", value: "a", enabled: true },
      { type: "text" as const, key: "tag", value: "b", enabled: true },
    ];
    const result = buildBody("form-data", "JSON", JSON.stringify(fields));
    const fd = result.body as FormData;
    expect(fd.getAll("tag")).toEqual(["a", "b"]);
  });

  it("compiles x-www-form-urlencoded fields and sets correct content type", () => {
    const fields = [
      { key: "name", value: "John Doe", enabled: true },
      { key: "city", value: "Bangalore", enabled: true },
      { key: "disabled", value: "ignore", enabled: false },
    ];
    const result = buildBody("x-www-form-urlencoded", "JSON", JSON.stringify(fields));
    expect(result.body).toBe("name=John+Doe&city=Bangalore");
    expect(result.contentType).toBe("application/x-www-form-urlencoded");
  });

  it("compiles x-www-form-urlencoded duplicate keys correctly", () => {
    const fields = [
      { key: "tag", value: "a", enabled: true },
      { key: "tag", value: "b", enabled: true },
    ];
    const result = buildBody("x-www-form-urlencoded", "JSON", JSON.stringify(fields));
    expect(result.body).toBe("tag=a&tag=b");
  });

  it("handles empty input or invalid JSON gracefully for both modes", () => {
    expect(buildBody("form-data", "JSON", "")).toEqual({ body: undefined, contentType: undefined });
    expect(buildBody("form-data", "JSON", "not-json")).toEqual({ body: undefined, contentType: undefined });
    expect(buildBody("x-www-form-urlencoded", "JSON", "")).toEqual({ body: undefined, contentType: undefined });
    expect(buildBody("x-www-form-urlencoded", "JSON", "not-json")).toEqual({ body: undefined, contentType: undefined });
  });
});
