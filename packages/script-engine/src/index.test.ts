import { describe, expect, it } from "vitest";
import { runScript, type ScriptContext } from "./index.ts";

function createContext(overrides: Partial<ScriptContext> = {}): ScriptContext {
  return {
    variables: { foo: "bar", secretKey: "12345" },
    request: {
      url: "https://httpbin.org/get",
      method: "GET",
      headers: { "accept": "application/json" }
    },
    ...overrides
  };
}

describe("Script Engine Sandbox", () => {
  it("executes valid script successfully", async () => {
    const script = `
      const val = apiLab.variables.get("foo");
      apiLab.variables.set("foo", val + "_updated");
    `;
    const result = await runScript(script, createContext());
    expect(result.status).toBe("success");
    expect(result.variables?.["foo"]).toBe("bar_updated");
    expect(result.error).toBeUndefined();
  });

  it("captures console logs, warnings, and errors", async () => {
    const script = `
      console.log("hello");
      console.warn("be careful");
      console.error("something broke");
    `;
    const result = await runScript(script, createContext());
    expect(result.status).toBe("success");
    expect(result.logs).toHaveLength(3);
    expect(result.logs[0]?.type).toBe("log");
    expect(result.logs[0]?.message).toBe("hello");
    expect(result.logs[1]?.type).toBe("warn");
    expect(result.logs[1]?.message).toBe("be careful");
    expect(result.logs[2]?.type).toBe("error");
    expect(result.logs[2]?.message).toBe("something broke");
  });

  it("handles syntax error as a structured failure", async () => {
    const script = `
      const val = ; // Syntax error
    `;
    const result = await runScript(script, createContext());
    expect(result.status).toBe("error");
    expect(result.error).toBeDefined();
    expect(result.variables).toBeUndefined();
  });

  it("handles runtime exceptions safely without crashing the runner", async () => {
    const script = `
      throw new Error("Simulated crash");
    `;
    const result = await runScript(script, createContext());
    expect(result.status).toBe("error");
    expect(result.error).toContain("Simulated crash");
  });

  it("handles execution timeout cleanly", async () => {
    const script = `
      while(true) {} // Infinite loop
    `;
    const result = await runScript(script, createContext(), 100);
    expect(result.status).toBe("timeout");
    expect(result.error).toContain("timed out");
  });

  it("cannot access document global", async () => {
    const script = `
      console.log(typeof document);
    `;
    const result = await runScript(script, createContext());
    expect(result.status).toBe("success");
    expect(result.logs[0]?.message).toBe("undefined");
  });

  it("cannot access window global", async () => {
    const script = `
      console.log(typeof window);
    `;
    const result = await runScript(script, createContext());
    expect(result.status).toBe("success");
    expect(result.logs[0]?.message).toBe("undefined");
  });

  it("cannot access localStorage or cookies", async () => {
    const script = `
      console.log(typeof localStorage);
      console.log(typeof sessionStorage);
    `;
    const result = await runScript(script, createContext());
    expect(result.status).toBe("success");
    expect(result.logs[0]?.message).toBe("undefined");
    expect(result.logs[1]?.message).toBe("undefined");
  });

  describe("Security Hardening & Sandbox Escape Protections", () => {
    it("blocks fetch and XMLHttpRequest recovery via prototype chain", async () => {
      const script = `
        try {
          const global = Function("return this")();
          const recovered = Object.getPrototypeOf(global).fetch;
          console.log(typeof recovered);
        } catch (e) {
          console.log("error");
        }
      `;
      const result = await runScript(script, createContext());
      expect(result.status).toBe("success");
      expect(result.logs[0]?.message).toBe("undefined");
    });

    it("blocks WebSocket and EventSource recovery", async () => {
      const script = `
        try {
          const global = Function("return this")();
          const ws = Object.getPrototypeOf(global).WebSocket;
          console.log(typeof ws);
        } catch (e) {
          console.log("error");
        }
      `;
      const result = await runScript(script, createContext());
      expect(result.status).toBe("success");
      expect(result.logs[0]?.message).toBe("undefined");
    });

    it("blocks indexedDB and caches/CacheStorage recovery", async () => {
      const script = `
        try {
          const global = Function("return this")();
          const db = Object.getPrototypeOf(global).indexedDB;
          const cache = Object.getPrototypeOf(global).caches;
          console.log(typeof db + "_" + typeof cache);
        } catch (e) {
          console.log("error");
        }
      `;
      const result = await runScript(script, createContext());
      expect(result.status).toBe("success");
      expect(result.logs[0]?.message).toBe("undefined_undefined");
    });

    it("blocks importScripts from loading external modules", async () => {
      const script = `
        try {
          console.log(typeof importScripts);
        } catch (e) {
          console.log("error");
        }
      `;
      const result = await runScript(script, createContext());
      expect(result.status).toBe("success");
      expect(result.logs[0]?.message).toBe("undefined");
    });

    it("blocks sendBeacon from navigator object", async () => {
      const script = `
        try {
          const global = Function("return this")();
          console.log(global.navigator ? typeof global.navigator.sendBeacon : "undefined");
        } catch (e) {
          console.log("error");
        }
      `;
      const result = await runScript(script, createContext());
      expect(result.status).toBe("success");
      expect(result.logs[0]?.message).toBe("undefined");
    });

    it("shadows self and globalThis inside the IIFE", async () => {
      const script = `
        console.log(typeof self + "_" + typeof globalThis);
      `;
      const result = await runScript(script, createContext());
      expect(result.status).toBe("success");
      expect(result.logs[0]?.message).toBe("undefined_undefined");
    });

    it("blocks Function constructor from recovering active network elements", async () => {
      const script = `
        try {
          const recoveredGlobal = Function("return this")();
          console.log(typeof recoveredGlobal.fetch);
        } catch (e) {
          console.log("error");
        }
      `;
      const result = await runScript(script, createContext());
      expect(result.status).toBe("success");
      expect(result.logs[0]?.message).toBe("undefined");
    });
  });
});
