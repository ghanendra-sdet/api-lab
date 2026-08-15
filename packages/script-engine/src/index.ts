import type { ScriptContext, ScriptResult } from "./types.ts";

export * from "./types.ts";

const workerCodeTemplate = (userScript: string) => `
self.onmessage = function(e) {
  const logs = [];
  const customConsole = {
    log: (...args) => logs.push({ type: "log", message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" "), timestamp: Date.now() }),
    warn: (...args) => logs.push({ type: "warn", message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" "), timestamp: Date.now() }),
    error: (...args) => logs.push({ type: "error", message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" "), timestamp: Date.now() })
  };

  let variables = {};

  try {
    const { context } = e.data;
    variables = { ...context.variables };

    // Securely sanitize Worker prototype chain and global namespace
    (function sanitize() {
      const forbidden = [
        "fetch",
        "XMLHttpRequest",
        "WebSocket",
        "EventSource",
        "indexedDB",
        "caches",
        "CacheStorage",
        "importScripts",
        "sendBeacon"
      ];
      let current = globalThis;
      while (current) {
        for (const prop of forbidden) {
          try {
            delete current[prop];
          } catch (e) {}
          try {
            Object.defineProperty(current, prop, {
              value: undefined,
              writable: false,
              configurable: false
            });
          } catch (e) {}
        }
        if (current === Object.prototype) {
          break;
        }
        try {
          const next = Object.getPrototypeOf(current);
          if (!next) break;
          current = next;
        } catch (e) {
          break;
        }
      }
      // Also defensively sanitize sendBeacon from WorkerNavigator prototype if present
      try {
        const nav = globalThis.WorkerNavigator;
        if (nav && nav.prototype) {
          delete nav.prototype.sendBeacon;
          Object.defineProperty(nav.prototype, "sendBeacon", {
            value: undefined,
            writable: false,
            configurable: false
          });
        }
      } catch (e) {}
    })();

    const apiLab = {
      variables: {
        get: (key) => variables[key] ?? "",
        set: (key, val) => { variables[key] = String(val); }
      },
      request: context.request,
      response: context.response
    };

    // Inject user script inside strict-mode IIFE shadowing key globals
    (function(console, apiLab, window, document, self, globalThis, postMessage, caches, indexedDB, XMLHttpRequest, WebSocket, EventSource, fetch, navigator) {
      "use strict";
      ${userScript}
    })(customConsole, apiLab, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined);

    self.postMessage({
      status: "success",
      logs,
      variables
    });
  } catch (err) {
    try {
      self.postMessage({
        status: "error",
        logs,
        error: err.message || String(err)
      });
    } catch (e) {
      // Fallback in case of absolute postMessage corruption
    }
  }
};
`;

/**
 * Execute user-provided script in a browser web worker sandbox.
 */
export function runInWorkerSandbox(scriptText: string, context: ScriptContext, timeout: number): Promise<ScriptResult> {
  return new Promise((resolve) => {
    let blob: Blob;
    try {
      blob = new Blob([workerCodeTemplate(scriptText)], { type: "application/javascript" });
    } catch (e) {
      resolve({
        status: "error",
        duration: 0,
        logs: [],
        error: "Failed to initialize worker sandbox Blob."
      });
      return;
    }

    const url = URL.createObjectURL(blob);
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch (e: any) {
      URL.revokeObjectURL(url);
      resolve({
        status: "error",
        duration: 0,
        logs: [],
        error: "Failed to construct Web Worker: " + (e.message || String(e))
      });
      return;
    }

    const startTime = Date.now();
    let timer: any = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
    };

    worker.onmessage = (e) => {
      cleanup();
      resolve({
        ...e.data,
        duration: Date.now() - startTime
      });
    };

    worker.onerror = (e) => {
      cleanup();
      resolve({
        status: "error",
        duration: Date.now() - startTime,
        logs: [],
        error: e.message || "Worker execution error"
      });
    };

    timer = setTimeout(() => {
      cleanup();
      resolve({
        status: "timeout",
        duration: Date.now() - startTime,
        logs: [],
        error: `Script execution timed out after ${timeout}ms`
      });
    }, timeout);

    worker.postMessage({ context });
  });
}

/**
 * Execute user-provided script in Node.js VM sandbox for unit tests.
 */
export async function runInNodeSandbox(scriptText: string, context: ScriptContext, timeout: number): Promise<ScriptResult> {
  const { default: vm } = await import("node:vm");
  const logs: any[] = [];
  const variables = { ...context.variables };

  const customConsole = {
    log: (...args: any[]) => logs.push({ type: "log", message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" "), timestamp: Date.now() }),
    warn: (...args: any[]) => logs.push({ type: "warn", message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" "), timestamp: Date.now() }),
    error: (...args: any[]) => logs.push({ type: "error", message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" "), timestamp: Date.now() }),
  };

  const apiLab = {
    variables: {
      get: (key: string) => variables[key] ?? "",
      set: (key: string, val: string) => { variables[key] = String(val); }
    },
    request: context.request,
    response: context.response
  };

  const sandbox = {
    console: customConsole,
    apiLab,
  };

  const startTime = Date.now();
  try {
    const vmContext = vm.createContext(sandbox);
    const shadowWrapper = `
      (function(window, document, global, globalThis) {
        ${scriptText}
      })(undefined, undefined, undefined, undefined);
    `;
    vm.runInContext(shadowWrapper, vmContext, { timeout });
    return {
      status: "success",
      duration: Date.now() - startTime,
      logs,
      variables
    };
  } catch (e: any) {
    const duration = Date.now() - startTime;
    if (e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" || e.message?.includes("timeout")) {
      return {
        status: "timeout",
        duration,
        logs,
        error: `Script execution timed out after ${timeout}ms`
      };
    }
    return {
      status: "error",
      duration,
      logs,
      error: e.message || String(e)
    };
  }
}

/**
 * Platform-agnostic script execution runner.
 */
export async function runScript(scriptText: string, context: ScriptContext, timeout: number = 3000): Promise<ScriptResult> {
  const isBrowser = typeof window !== "undefined" && typeof Worker !== "undefined";
  if (isBrowser) {
    return runInWorkerSandbox(scriptText, context, timeout);
  } else {
    return runInNodeSandbox(scriptText, context, timeout);
  }
}
