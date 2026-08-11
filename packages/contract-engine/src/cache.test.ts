import { beforeEach, describe, expect, it } from "vitest";
import { clearContractCache, contractCacheSize, hashSource, parseContractCached } from "./cache.ts";
import { MAX_CACHED_CONTRACTS } from "./limits.ts";
import { SPEC_30, SPEC_31 } from "./testFixtures.ts";

describe("hashSource", () => {
  it("is stable for identical text", () => {
    expect(hashSource(SPEC_30)).toBe(hashSource(SPEC_30));
  });

  it("differs for different text", () => {
    expect(hashSource(SPEC_30)).not.toBe(hashSource(SPEC_31));
    expect(hashSource("a")).not.toBe(hashSource("b"));
  });

  it("mixes in length, so same-length collisions stay distinguishable", () => {
    expect(hashSource("ab")).toContain(":2");
    expect(hashSource("abc")).toContain(":3");
  });
});

describe("parseContractCached (spec §42)", () => {
  beforeEach(() => {
    clearContractCache();
  });

  it("returns the identical result object on a repeat parse", () => {
    const first = parseContractCached(SPEC_30);
    const second = parseContractCached(SPEC_30);

    expect(first.ok).toBe(true);
    // Identity, not just equality — proof the document was not re-walked.
    expect(second).toBe(first);
    expect(contractCacheSize()).toBe(1);
  });

  it("re-parses when the source text changes, with no invalidation logic to get wrong", () => {
    const first = parseContractCached(SPEC_30);
    const edited = parseContractCached(`${SPEC_30} `);

    expect(edited).not.toBe(first);
    expect(contractCacheSize()).toBe(2);
  });

  it("keeps distinct specifications separate", () => {
    const thirty = parseContractCached(SPEC_30);
    const thirtyOne = parseContractCached(SPEC_31);

    expect(thirty.ok && thirty.contract.version).toBe("3.0");
    expect(thirtyOne.ok && thirtyOne.contract.version).toBe("3.1");
  });

  it("caches failures too, so a broken document is not re-parsed repeatedly", () => {
    const first = parseContractCached("{not json");
    const second = parseContractCached("{not json");

    expect(first.ok).toBe(false);
    expect(second).toBe(first);
  });

  it("evicts the least recently used entry past the capacity limit", () => {
    for (let i = 0; i < MAX_CACHED_CONTRACTS + 5; i++) {
      parseContractCached(JSON.stringify({ openapi: "3.0.3", info: { title: `t${i}` }, paths: {} }));
    }
    expect(contractCacheSize()).toBeLessThanOrEqual(MAX_CACHED_CONTRACTS);
  });

  it("keeps a recently reused entry alive under eviction pressure", () => {
    const hot = parseContractCached(SPEC_30);
    for (let i = 0; i < MAX_CACHED_CONTRACTS - 1; i++) {
      parseContractCached(JSON.stringify({ openapi: "3.0.3", info: { title: `t${i}` }, paths: {} }));
      parseContractCached(SPEC_30); // Touch it to refresh recency.
    }
    expect(parseContractCached(SPEC_30)).toBe(hot);
  });

  it("clears completely on demand", () => {
    parseContractCached(SPEC_30);
    clearContractCache();
    expect(contractCacheSize()).toBe(0);
  });
});
