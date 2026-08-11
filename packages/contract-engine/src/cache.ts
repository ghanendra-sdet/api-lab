import { MAX_CACHED_CONTRACTS } from "./limits.ts";
import { parseContract, type ContractParseResult } from "./parse.ts";

/**
 * Contract parse cache (spec §42).
 *
 * Parsing and normalizing a specification walks every schema in the
 * document. Doing that again for every keystroke in the Contract panel, and
 * again for every request in a Collection Runner pass, would make contract
 * validation feel broken on a large specification even though the validation
 * itself is fast.
 *
 * The cache is keyed by a hash of the source text, so it is correct by
 * construction: editing or re-importing a specification changes the text,
 * which changes the key, which misses the cache. There is no invalidation
 * logic to get wrong.
 *
 * It stores parse *results*, including failures. A malformed document that
 * is re-selected repeatedly should not be re-parsed repeatedly just because
 * it failed.
 */

/** FNV-1a. Not cryptographic — this is a cache key, not a security boundary. */
export function hashSource(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Length is mixed in so two different-length strings colliding on the
  // 32-bit hash still produce different keys.
  return `${hash.toString(16)}:${text.length}`;
}

const cache = new Map<string, ContractParseResult>();

/** Parses a specification, reusing the previous result when the text is unchanged. */
export function parseContractCached(text: string): ContractParseResult {
  const key = hashSource(text);
  const hit = cache.get(key);
  if (hit) {
    // Re-inserting refreshes recency for the LRU eviction below.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const result = parseContract(text);
  cache.set(key, result);

  if (cache.size > MAX_CACHED_CONTRACTS) {
    // Map preserves insertion order, so the first key is the least recently used.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }

  return result;
}

/** Drops every cached contract. Exposed for tests and for an explicit reset. */
export function clearContractCache(): void {
  cache.clear();
}

export function contractCacheSize(): number {
  return cache.size;
}
