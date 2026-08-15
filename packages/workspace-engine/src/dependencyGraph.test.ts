import { describe, expect, it } from "vitest";
import {
  findDuplicateDependency,
  formatCircularDependencyChain,
  resolveDependencyOrder,
  type DependencyMap,
} from "./dependencyGraph.ts";

describe("resolveDependencyOrder", () => {
  it("1. resolves a request with no dependencies to just itself", () => {
    const deps: DependencyMap = { A: [] };
    const result = resolveDependencyOrder("A", deps);
    expect(result).toEqual({ ok: true, order: ["A"] });
  });

  it("2. resolves one dependency before the dependent request", () => {
    const deps: DependencyMap = { A: [], B: ["A"] };
    const result = resolveDependencyOrder("B", deps);
    expect(result).toEqual({ ok: true, order: ["A", "B"] });
  });

  it("3. resolves a nested dependency chain (C depends on B depends on A) in A, B, C order", () => {
    const deps: DependencyMap = { A: [], B: ["A"], C: ["B"] };
    const result = resolveDependencyOrder("C", deps);
    expect(result).toEqual({ ok: true, order: ["A", "B", "C"] });
  });

  it("4. resolves multiple dependencies in declared order (B depends on [A, C])", () => {
    const deps: DependencyMap = { A: [], C: [], B: ["A", "C"] };
    const result = resolveDependencyOrder("B", deps);
    expect(result).toEqual({ ok: true, order: ["A", "C", "B"] });
  });

  it("5. rejects a direct self-dependency (A -> A)", () => {
    const deps: DependencyMap = { A: ["A"] };
    const result = resolveDependencyOrder("A", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "self-dependency", requestId: "A" });
    }
  });

  it("6. rejects a two-request cycle (A -> B -> A) and reports the chain", () => {
    const deps: DependencyMap = { A: ["B"], B: ["A"] };
    const result = resolveDependencyOrder("A", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "circular-dependency", chain: ["A", "B", "A"] });
      if (result.error.type === "circular-dependency") {
        expect(formatCircularDependencyChain(result.error.chain)).toBe("A → B → A");
      }
    }
  });

  it("7. rejects a three-request cycle (A -> B -> C -> A) and reports the full chain", () => {
    const deps: DependencyMap = { A: ["B"], B: ["C"], C: ["A"] };
    const result = resolveDependencyOrder("A", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "circular-dependency", chain: ["A", "B", "C", "A"] });
    }
  });

  it("8. reports a missing dependency explicitly rather than silently ignoring it", () => {
    const deps: DependencyMap = { B: ["A"] };
    const result = resolveDependencyOrder("B", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "missing-dependency", requestId: "B", missingId: "A" });
    }
  });

  it("9. reports a duplicate dependency ID within one request's own list", () => {
    const deps: DependencyMap = { A: [], B: ["A", "A"] };
    const result = resolveDependencyOrder("B", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "duplicate-dependency", requestId: "B", duplicateId: "A" });
    }
  });

  it("10. produces a deterministic order across repeated calls for the same graph", () => {
    const deps: DependencyMap = { A: [], B: [], C: ["A", "B"], D: ["C"] };
    const first = resolveDependencyOrder("D", deps);
    const second = resolveDependencyOrder("D", deps);
    expect(first).toEqual(second);
    expect(first).toEqual({ ok: true, order: ["A", "B", "C", "D"] });
  });

  it("11. resolves a diamond (D depends on [B, C], both depending on shared A) with A appearing exactly once", () => {
    const deps: DependencyMap = { A: [], B: ["A"], C: ["A"], D: ["B", "C"] };
    const result = resolveDependencyOrder("D", deps);
    expect(result).toEqual({ ok: true, order: ["A", "B", "C", "D"] });
    if (result.ok) {
      expect(result.order.filter((id) => id === "A")).toHaveLength(1);
    }
  });

  it("12. reports a duplicate dependency found on a nested node, not just the queried root", () => {
    const deps: DependencyMap = { A: [], B: ["A", "A"], C: ["B"] };
    const result = resolveDependencyOrder("C", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "duplicate-dependency", requestId: "B", duplicateId: "A" });
    }
  });

  it("13. reports a missing dependency found on a nested node, attributing it to the referencing request rather than the queried root", () => {
    const deps: DependencyMap = { B: ["A"], C: ["B"] };
    const result = resolveDependencyOrder("C", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "missing-dependency", requestId: "B", missingId: "A" });
    }
  });

  it("14. reports a self-dependency found on a nested node (A depends on B, B depends on itself)", () => {
    const deps: DependencyMap = { A: ["B"], B: ["B"] };
    const result = resolveDependencyOrder("A", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "self-dependency", requestId: "B" });
    }
  });
});

describe("findDuplicateDependency", () => {
  it("returns null when every ID is unique", () => {
    expect(findDuplicateDependency(["A", "B", "C"])).toBeNull();
  });

  it("returns the first repeated ID", () => {
    expect(findDuplicateDependency(["A", "B", "A"])).toBe("A");
  });
});
