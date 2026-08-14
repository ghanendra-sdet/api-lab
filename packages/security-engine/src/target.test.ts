import { describe, expect, it } from "vitest";
import { assertTargetConfirmed, classifyTarget, collectTargetHosts } from "./target.ts";

describe("classifyTarget", () => {
  it("treats loopback hosts as local and frictionless", () => {
    for (const url of ["http://localhost:4010/x", "http://127.0.0.1:8080/", "http://127.0.0.5/", "https://app.localhost/"]) {
      const classification = classifyTarget(url);
      expect(classification.scope, url).toBe("local");
      expect(classification.requiresConfirmation, url).toBe(false);
    }
  });

  it("treats a private-range address as remote", () => {
    // "It's on the internal network" has never been a reason it was fine to
    // fire a hundred malformed requests at a colleague's machine.
    const classification = classifyTarget("http://10.0.0.5/api");
    expect(classification.scope).toBe("remote");
    expect(classification.requiresConfirmation).toBe(true);
  });

  it("treats a public host as remote", () => {
    const classification = classifyTarget("https://api.example.com/users");
    expect(classification.scope).toBe("remote");
    expect(classification.host).toBe("api.example.com");
    expect(classification.origin).toBe("https://api.example.com");
  });

  it("classifies a non-HTTP scheme as invalid rather than defaulting to local", () => {
    // Failing toward "local" for an unknown scheme would be the wrong
    // direction to be wrong in.
    const classification = classifyTarget("ftp://example.com/x");
    expect(classification.scope).toBe("invalid");
    expect(classification.requiresConfirmation).toBe(true);
  });

  it("classifies an unparseable URL as invalid", () => {
    expect(classifyTarget("not a url").scope).toBe("invalid");
  });
});

describe("assertTargetConfirmed", () => {
  it("allows a loopback target with no confirmation", () => {
    expect(assertTargetConfirmed("http://localhost:4010/x", null).ok).toBe(true);
  });

  it("refuses a remote target with no confirmation", () => {
    const gate = assertTargetConfirmed("https://api.example.com/x", null);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("api.example.com");
  });

  it("allows a remote target whose host was confirmed", () => {
    expect(assertTargetConfirmed("https://api.example.com/x", "api.example.com").ok).toBe(true);
  });

  it("refuses when the confirmed host does not match the resolved host", () => {
    // The whole point: an approval for staging cannot be reused for prod
    // after a variable resolves differently than expected.
    const gate = assertTargetConfirmed("https://api.example.com/x", "staging.example.com");
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("does not match");
  });

  it("compares hosts case-insensitively", () => {
    expect(assertTargetConfirmed("https://API.Example.com/x", "api.example.com").ok).toBe(true);
  });

  it("refuses an invalid target even when a host was confirmed", () => {
    expect(assertTargetConfirmed("ftp://example.com/x", "example.com").ok).toBe(false);
  });
});

describe("collectTargetHosts", () => {
  it("returns each distinct host once, sorted", () => {
    const hosts = collectTargetHosts([
      "https://b.example.com/1",
      "https://a.example.com/2",
      "https://b.example.com/3",
    ]);
    expect(hosts).toEqual(["a.example.com", "b.example.com"]);
  });

  it("ignores unparseable URLs", () => {
    expect(collectTargetHosts(["not a url"])).toEqual([]);
  });
});
