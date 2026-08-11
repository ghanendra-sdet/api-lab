import { createAssertionId } from "./id.ts";
import { OPERATORS_BY_TARGET, type Assertion, type AssertionTarget } from "./types.ts";

export function createAssertion(target: AssertionTarget = "status"): Assertion {
  return {
    id: createAssertionId(),
    target,
    operator: OPERATORS_BY_TARGET[target][0]!,
    key: target === "header" || target === "json" ? "" : undefined,
    expected: target === "status" ? "200" : "",
    enabled: true,
  };
}
