import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  escapeHtmlValue,
  escapeMarkdownCell,
  fencedCodeBlock,
  serializeForScript,
} from "./escape.ts";
import { SCRIPT_BREAKOUT_PAYLOAD, XSS_PAYLOAD } from "./testFixtures.ts";

describe("escapeHtml", () => {
  it("neutralizes a script tag", () => {
    const escaped = escapeHtml(XSS_PAYLOAD);
    expect(escaped).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escaped).not.toContain("<script");
  });

  it("escapes both quote characters, so attribute position is safe", () => {
    // The attack this closes: `id="<value>"` where value is `" onload="x`.
    expect(escapeHtml('" onload="alert(1)')).toBe("&quot; onload=&quot;alert(1)");
    expect(escapeHtml("' onload='alert(1)")).toBe("&#39; onload=&#39;alert(1)");
  });

  it("escapes ampersands first, so escapes are not double-decoded", () => {
    // If `&` were escaped last, `&lt;` would become `&lt;` again and decode
    // back to a literal `<` in the browser.
    expect(escapeHtml("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
  });

  it("leaves ordinary prose untouched", () => {
    expect(escapeHtml("Returns a page of orders.")).toBe("Returns a page of orders.");
  });

  it("handles an empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("escapeHtmlValue", () => {
  it("renders undefined and null as empty, never as the word", () => {
    expect(escapeHtmlValue(undefined)).toBe("");
    expect(escapeHtmlValue(null)).toBe("");
  });

  it("coerces and escapes non-strings", () => {
    expect(escapeHtmlValue(42)).toBe("42");
    expect(escapeHtmlValue(true)).toBe("true");
  });
});

describe("serializeForScript", () => {
  it("prevents a </script> breakout", () => {
    const serialized = serializeForScript({ description: SCRIPT_BREAKOUT_PAYLOAD });
    // The literal sequence the HTML parser looks for must not survive.
    expect(serialized).not.toContain("</script");
    expect(serialized).not.toContain("<img");
    expect(serialized).toContain("\\u003c");
  });

  it("round-trips through JSON.parse unchanged", () => {
    // Escaping must not corrupt the data — the search index has to still match
    // the real text.
    const value = { description: SCRIPT_BREAKOUT_PAYLOAD, path: "/a<b>c" };
    expect(JSON.parse(serializeForScript(value))).toEqual(value);
  });

  it("escapes U+2028 and U+2029", () => {
    const serialized = serializeForScript({ text: "a\u2028b\u2029c" });
    expect(serialized).toContain("\\u2028");
    expect(serialized).toContain("\\u2029");
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
  });

  it("serializes arrays and nested structures", () => {
    expect(JSON.parse(serializeForScript([{ a: [1, 2] }]))).toEqual([{ a: [1, 2] }]);
  });
});

describe("escapeMarkdownCell", () => {
  it("escapes pipes so a table row cannot be split", () => {
    expect(escapeMarkdownCell("a | b")).toBe("a \\| b");
  });

  it("flattens newlines so a row cannot be ended early", () => {
    expect(escapeMarkdownCell("line one\nline two")).toBe("line one line two");
    expect(escapeMarkdownCell("line one\r\nline two")).toBe("line one line two");
  });
});

describe("fencedCodeBlock", () => {
  it("uses a three-backtick fence for ordinary content", () => {
    expect(fencedCodeBlock("hello", "json")).toBe("```json\nhello\n```");
  });

  it("widens the fence past any backtick run in the content", () => {
    const block = fencedCodeBlock("a ``` b");
    expect(block.startsWith("````")).toBe(true);
    expect(block.endsWith("````")).toBe(true);
  });

  it("widens past a longer run too", () => {
    const block = fencedCodeBlock("`````");
    expect(block.startsWith("``````")).toBe(true);
  });
});
