/**
 * Deterministic identifiers for documentation anchors (spec §33).
 *
 * Every id in generated documentation is a pure function of the content it
 * names. There is no counter, no random component, and no timestamp — which
 * is what makes the golden-file tests in render/*.test.ts meaningful rather
 * than decorative. Two runs over the same specification produce byte-identical
 * output, so a documentation file checked into a docs repo shows a diff only
 * when the API actually changed.
 *
 * The ids double as HTML fragment anchors (`#get-users-id`) and as Markdown
 * heading anchors, so they have to survive both: lowercase, ASCII-safe, no
 * spaces, no punctuation that means something in a URL.
 */

/**
 * Slugifies arbitrary text into an anchor-safe token.
 *
 * Non-alphanumerics collapse to single hyphens rather than being dropped,
 * because dropping them makes `/users/{id}` and `/usersid` collide — and a
 * duplicate anchor silently sends every link to whichever heading came first.
 */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "untitled" : slug;
}

/** The stable id (and anchor) for a documented endpoint. */
export function endpointId(method: string, path: string): string {
  return slugify(`${method} ${path}`);
}

/** The stable id (and anchor) for a documented group. */
export function groupId(name: string): string {
  return `group-${slugify(name)}`;
}

/** The stable id (and anchor) for a documented schema. */
export function schemaId(name: string): string {
  return `schema-${slugify(name)}`;
}

/**
 * Ensures a set of ids is unique by appending a numeric discriminator.
 *
 * Two different tags can slugify identically ("User Management" and
 * "user-management"), and two anchors with the same id is a silently broken
 * navigation link rather than a visible error. The discriminator is assigned
 * in stable input order, so it is deterministic like everything else here.
 */
export function uniqueId(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) {
    taken.add(candidate);
    return candidate;
  }
  let counter = 2;
  while (taken.has(`${candidate}-${counter}`)) counter += 1;
  const result = `${candidate}-${counter}`;
  taken.add(result);
  return result;
}
