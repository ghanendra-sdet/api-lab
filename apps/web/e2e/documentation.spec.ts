import { test, expect, type FrameLocator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Milestone 13 — API Documentation Generation E2E (spec §40).
 *
 * The twelve scenarios spec §40 requires, each driving the real Documentation
 * workspace against a real imported specification and a real seeded
 * collection. Nothing is stubbed: the preview under assertion is the same
 * HTML the Export button writes to disk.
 *
 * ## On the localStorage seeding below
 *
 * `seedCollection` writes a collection straight into localStorage rather than
 * clicking through the collection UI, following the precedent
 * `security.spec.ts` and `contract.spec.ts` set. Collection authoring
 * (Milestone 3) and the body editor (Milestone 2's Monaco instance, which
 * takes seconds to drive) already have their own E2E coverage; these
 * scenarios spend their time on what Milestone 13 introduced. Specification
 * import and every documentation action still go through the real UI.
 *
 * ## On reading the preview through a frame
 *
 * Generated HTML renders inside a sandboxed iframe (see
 * `components/documentation/DocumentationPreview.tsx`), so assertions go
 * through `frameLocator`. That is deliberate rather than incidental: it means
 * these tests observe exactly what a reader of the exported file observes,
 * including whether the in-page search actually runs.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "documentation");
const DOCS_SPEC = join(FIXTURES, "docs-api.json");
const HOSTILE_SPEC = join(FIXTURES, "hostile-api.json");

/**
 * Specifications are named after the imported file, minus its extension —
 * see `ContractManager.tsx`. The Documentation dialog's select shows that
 * name alone, without the `(OpenAPI 3.0.3)` suffix the Contract dialog adds.
 */
const DOCS_SPEC_LABEL = "docs-api";
const HOSTILE_SPEC_LABEL = "hostile-api";

const COLLECTION_NAME = "Docs Collection";

/**
 * Canary credentials for scenario 6.
 *
 * Distinctive and self-identifying, so an assertion that they never appear
 * cannot pass by coincidence — the same discipline `secretCanary.test.ts`
 * applies at the unit level, repeated here end to end through the real UI.
 */
const CANARY_TOKEN = "CANARY-E2E-BEARER-0a1b2c3d4e5f60718293a4b5c6d7e8f9";
const CANARY_API_KEY = "CANARY-E2E-APIKEY-fedcba98765432100123456789abcdef";
const CANARY_PASSWORD = "CANARY-E2E-PASSWORD-9182736450abcdef";
const ALL_CANARIES = [CANARY_TOKEN, CANARY_API_KEY, CANARY_PASSWORD];

interface SeedRequest {
  name: string;
  method: string;
  url: string;
  folderName?: string;
  body?: string;
  headers?: Array<{ key: string; value: string }>;
  params?: Array<{ key: string; value: string }>;
  bearerToken?: string;
}

/** Writes a collection containing the given requests into localStorage. */
async function seedCollection(page: Page, requests: SeedRequest[]): Promise<void> {
  await page.evaluate(
    ({ collectionName, entries }) => {
      const now = new Date().toISOString();

      const toRequest = (entry: (typeof entries)[number], index: number) => ({
        id: `req-doc-${index}`,
        type: "request",
        name: entry.name,
        request: {
          method: entry.method,
          url: entry.url,
          params: (entry.params ?? []).map((param, i) => ({
            id: `p-${i}`,
            key: param.key,
            value: param.value,
            enabled: true,
          })),
          headers: [
            ...(entry.body === undefined
              ? []
              : [{ id: "h-ct", key: "Content-Type", value: "application/json", enabled: true }]),
            ...(entry.headers ?? []).map((header, i) => ({
              id: `h-${i}`,
              key: header.key,
              value: header.value,
              enabled: true,
            })),
          ],
          auth:
            entry.bearerToken === undefined
              ? { type: "none" }
              : { type: "bearer", token: entry.bearerToken },
          bodyMode: entry.body === undefined ? "none" : "raw",
          bodyRawFormat: "JSON",
          bodyRawContent: entry.body ?? "",
          tests: [],
          extractions: [],
        },
        createdAt: now,
        updatedAt: now,
      });

      const topLevel = entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.folderName === undefined)
        .map(({ entry, index }) => toRequest(entry, index));

      const folderNames = [
        ...new Set(
          entries
            .map((entry) => entry.folderName)
            .filter((name): name is string => name !== undefined),
        ),
      ];

      const folders = folderNames.map((folderName, folderIndex) => ({
        id: `folder-doc-${folderIndex}`,
        type: "folder",
        name: folderName,
        items: entries
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry.folderName === folderName)
          .map(({ entry, index }) => toRequest(entry, index)),
        createdAt: now,
        updatedAt: now,
      }));

      window.localStorage.setItem(
        "api-lab-workspace",
        JSON.stringify({
          version: 1,
          workspace: {
            collections: [
              {
                id: "col-docs",
                name: collectionName,
                description: "Saved requests for the docs demo API.",
                items: [...topLevel, ...folders],
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
        }),
      );
    },
    { collectionName: COLLECTION_NAME, entries: requests },
  );

  await page.reload();
}

/** Imports a specification through the real Contract manager UI. */
async function importSpecification(page: Page, fixturePath: string): Promise<void> {
  await page.getByRole("button", { name: "Contract", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Contract" });
  await dialog.getByLabel("Import OpenAPI specification").setInputFiles(fixturePath);
  await expect(dialog.getByText(/operations$/).first()).toBeVisible();
  await dialog.getByRole("button", { name: "Close contract manager" }).click();
}

async function openDocumentation(page: Page) {
  await page.getByRole("button", { name: "Documentation", exact: true }).click();
  return page.getByRole("dialog", { name: "Documentation" });
}

interface GenerateOptions {
  source: "OpenAPI specification" | "Collection" | "OpenAPI + Collection";
  specificationLabel?: string;
  collectionLabel?: string;
  format?: "HTML" | "Markdown" | "JSON";
  grouping?: string;
  sections?: Partial<Record<string, boolean>>;
}

/** Drives the Documentation dialog through a full generation. */
async function generate(page: Page, options: GenerateOptions) {
  const dialog = await openDocumentation(page);

  await dialog.locator("#doc-source").selectOption({ label: options.source });

  // Addressed by id rather than by label: `getByLabel("Collection")` also
  // matches the "Include collection examples" checkbox.
  if (options.specificationLabel !== undefined) {
    await dialog.locator("#doc-specification").selectOption({ label: options.specificationLabel });
  }
  if (options.collectionLabel !== undefined) {
    await dialog.locator("#doc-collection").selectOption({ label: options.collectionLabel });
  }
  if (options.grouping !== undefined) {
    await dialog.locator("#doc-grouping").selectOption({ label: options.grouping });
  }

  for (const [label, enabled] of Object.entries(options.sections ?? {})) {
    const checkbox = dialog.getByRole("checkbox", { name: label, exact: true });
    if (enabled === true) await checkbox.check();
    else await checkbox.uncheck();
  }

  // Format last: it re-renders rather than regenerating, and setting it before
  // the source would be discarded by the source change.
  if (options.format !== undefined) {
    await dialog.locator("#doc-format").selectOption({ label: options.format });
  }

  await dialog.getByTestId("generate-documentation").click();
  return dialog;
}

/** The generated HTML page, as the reader of the exported file sees it. */
function preview(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="documentation-preview-frame"]');
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

// ---------------------------------------------------------------------------
// 1. OpenAPI documentation
// ---------------------------------------------------------------------------

test("1: generates documentation from an imported OpenAPI specification", async ({ page }) => {
  await importSpecification(page, DOCS_SPEC);

  const dialog = await generate(page, {
    source: "OpenAPI specification",
    specificationLabel: DOCS_SPEC_LABEL,
  });

  await expect(dialog.getByTestId("documentation-summary")).toContainText("5 endpoints");

  const frame = preview(page);
  await expect(frame.locator("h1")).toHaveText("Docs Demo API");
  await expect(frame.locator("#get-docs-invoices")).toBeVisible();
  await expect(frame.locator("#get-docs-invoices")).toContainText("List invoices");
  await expect(frame.locator("#get-docs-invoices")).toContainText(
    "Returns every invoice visible to the caller.",
  );

  // Parameters, with the documented columns (spec §10).
  await expect(frame.locator("#get-docs-invoices")).toContainText("state");
  await expect(frame.locator("#get-docs-invoices")).toContainText("one of: draft, sent, paid");

  // Less common methods are not dropped (spec §9).
  await expect(frame.locator("#head-docs-invoices-invoiceid")).toBeVisible();
  await expect(frame.locator(".method-delete").first()).toBeVisible();

  // Grouped by declared tag order (spec §28).
  await expect(frame.locator("#group-invoices")).toHaveText("Invoices");
  await expect(frame.locator("#group-accounts")).toHaveText("Accounts");
});

// ---------------------------------------------------------------------------
// 2. Collection documentation
// ---------------------------------------------------------------------------

test("2: generates documentation from a collection with no specification", async ({ page }) => {
  await seedCollection(page, [
    {
      name: "List invoices",
      method: "GET",
      url: "http://localhost:4010/__docs/invoices",
      folderName: "Invoices",
      params: [{ key: "state", value: "paid" }],
    },
    {
      name: "List accounts",
      method: "GET",
      url: "http://localhost:4010/__docs/accounts",
      folderName: "Accounts",
    },
  ]);

  const dialog = await generate(page, {
    source: "Collection",
    collectionLabel: COLLECTION_NAME,
  });

  await expect(dialog.getByTestId("documentation-summary")).toContainText("2 endpoints");

  const frame = preview(page);
  await expect(frame.locator("h1")).toHaveText(COLLECTION_NAME);

  // Grouped by folder, since there are no tags (spec §28).
  await expect(frame.locator("#group-invoices")).toHaveText("Invoices");
  await expect(frame.locator("#group-accounts")).toHaveText("Accounts");

  // Every fact is labelled as collection-derived, and nothing is presented as
  // contractual (spec §7).
  await expect(frame.getByText("Source: Collection").first()).toBeVisible();
  await expect(frame.getByText("Not part of a contract").first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// 3. Combined documentation
// ---------------------------------------------------------------------------

test("3: combines a specification's contract with a collection's examples", async ({ page }) => {
  await seedCollection(page, [
    {
      name: "Create invoice",
      method: "POST",
      url: "http://localhost:4010/__docs/invoices",
      body: '{"amount":999.99,"state":"draft"}',
    },
    {
      name: "Internal metrics",
      method: "GET",
      url: "http://localhost:4010/__docs/internal/metrics",
    },
  ]);
  await importSpecification(page, DOCS_SPEC);

  await generate(page, {
    source: "OpenAPI + Collection",
    specificationLabel: DOCS_SPEC_LABEL,
    collectionLabel: COLLECTION_NAME,
  });

  const frame = preview(page);

  // The contract still defines the endpoint…
  const post = frame.locator("#post-docs-invoices");
  await expect(post).toContainText("Create an invoice");
  await expect(post).toContainText("Creates a draft invoice.");
  await expect(post).toContainText("Source: OpenAPI");

  // …and the collection illustrates it (spec §5).
  await expect(post).toContainText("999.99");
  await expect(post).toContainText("Source: Collection");

  // A saved request the specification does not document is kept and labelled,
  // rather than silently dropped (spec §22).
  await expect(frame.locator("#group-not-in-specification")).toBeVisible();
  await expect(frame.locator("#get-docs-internal-metrics")).toBeVisible();
});

// ---------------------------------------------------------------------------
// 4. Schema documentation
// ---------------------------------------------------------------------------

test("4: documents nested and recursive schemas without runaway output", async ({ page }) => {
  await importSpecification(page, DOCS_SPEC);
  await generate(page, {
    source: "OpenAPI specification",
    specificationLabel: DOCS_SPEC_LABEL,
  });

  const frame = preview(page);

  await expect(frame.locator("#schema-invoice")).toBeVisible();
  await expect(frame.locator("#schema-account")).toBeVisible();
  await expect(frame.locator("#schema-address")).toBeVisible();

  const invoice = frame.locator("#schema-invoice + *");
  await expect(invoice).toContainText("id");
  await expect(invoice).toContainText("required");

  // A 3.0 `nullable: true` documents identically to a 3.1 type union.
  await expect(invoice).toContainText("string | null");

  // Nested expansion: Invoice → Account → Address.
  await expect(invoice).toContainText("billingAddress");

  // And the self-reference terminates rather than recursing (spec §14).
  await expect(frame.getByText("Account → see Account").first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// 5. Authentication
// ---------------------------------------------------------------------------

test("5: documents authentication schemes without any credential", async ({ page }) => {
  await importSpecification(page, DOCS_SPEC);
  await generate(page, {
    source: "OpenAPI specification",
    specificationLabel: DOCS_SPEC_LABEL,
  });

  const frame = preview(page);
  const authentication = frame.locator("#authentication");

  await expect(authentication).toContainText("bearerAuth");
  await expect(authentication).toContainText("Bearer format: JWT");
  await expect(authentication).toContainText("Authorization: Bearer {{token}}");

  await expect(authentication).toContainText("tenantKey");
  // The header *name* is documented; there is no value to document.
  await expect(authentication).toContainText("X-Tenant-Key");
  await expect(authentication).toContainText("X-Tenant-Key: {{apiKey}}");

  // The policy is stated in the output, not only in the code (spec §15, §16).
  await expect(authentication).toContainText("Credential values are never included");

  // An operation declaring `security: []` is documented as public.
  await expect(frame.locator("#delete-docs-invoices-invoiceid")).not.toContainText("bearerAuth");
});

// ---------------------------------------------------------------------------
// 6. Secret redaction
// ---------------------------------------------------------------------------

test("6: never emits a credential into generated documentation", async ({ page }) => {
  await seedCollection(page, [
    {
      name: "Create invoice",
      method: "POST",
      url: `http://localhost:4010/__docs/invoices?api_key=${CANARY_API_KEY}`,
      bearerToken: CANARY_TOKEN,
      headers: [
        { key: "Authorization", value: `Bearer ${CANARY_TOKEN}` },
        { key: "X-Api-Key", value: CANARY_API_KEY },
      ],
      params: [{ key: "api_key", value: CANARY_API_KEY }],
      body: `{"amount":10,"password":"${CANARY_PASSWORD}","access_token":"${CANARY_TOKEN}"}`,
    },
  ]);

  for (const format of ["HTML", "Markdown", "JSON"] as const) {
    await generate(page, {
      source: "Collection",
      collectionLabel: COLLECTION_NAME,
      format,
    });

    const content =
      format === "HTML"
        ? await preview(page).locator("body").innerHTML()
        : await page.getByTestId("documentation-preview-text").innerText();

    for (const canary of ALL_CANARIES) {
      expect(content, `${canary} leaked into ${format}`).not.toContain(canary);
    }

    // Not passing by omission: the endpoint and its harmless data are present,
    // and the redaction is visible rather than a silent deletion.
    expect(content).toContain("__docs/invoices");
    expect(content).toContain("{{redacted}}");

    await page.getByRole("button", { name: "Close documentation manager" }).click();
  }
});

// ---------------------------------------------------------------------------
// 7. HTML safety
// ---------------------------------------------------------------------------

test("7: escapes hostile specification content instead of executing it", async ({ page }) => {
  await importSpecification(page, HOSTILE_SPEC);
  await generate(page, {
    source: "OpenAPI specification",
    specificationLabel: HOSTILE_SPEC_LABEL,
  });

  const frame = preview(page);

  // The payload is rendered — as text. If it were dropped instead, the
  // assertions below would pass while proving nothing.
  await expect(frame.getByText("window.__API_LAB_XSS_DESCRIPTION", { exact: false }).first()).toBeVisible();

  // Nothing the specification supplied executed inside the frame.
  const executed = await frame.locator("body").evaluate(() =>
    [
      "__API_LAB_XSS_INFO",
      "__API_LAB_XSS_TAG",
      "__API_LAB_XSS_SUMMARY",
      "__API_LAB_XSS_DESCRIPTION",
      "__API_LAB_XSS_IMG",
      "__API_LAB_XSS_PARAM",
      "__API_LAB_XSS_RESPONSE",
      "__API_LAB_XSS_EXAMPLE",
      "__API_LAB_XSS_SCHEMA",
      "__API_LAB_XSS_BREAKOUT",
    ].filter((flag) => (window as unknown as Record<string, unknown>)[flag] !== undefined),
  );
  expect(executed).toEqual([]);

  // No injected element exists in the DOM at all.
  await expect(frame.locator("img")).toHaveCount(0);

  // …and nothing escaped into API Lab's own page either.
  const hostFlags = await page.evaluate(() =>
    Object.keys(window as unknown as Record<string, unknown>).filter((key) =>
      key.startsWith("__API_LAB_XSS"),
    ),
  );
  expect(hostFlags).toEqual([]);
});

// ---------------------------------------------------------------------------
// 8. Markdown export
// ---------------------------------------------------------------------------

test("8: generates deterministic Markdown", async ({ page }) => {
  await importSpecification(page, DOCS_SPEC);
  await generate(page, {
    source: "OpenAPI specification",
    specificationLabel: DOCS_SPEC_LABEL,
    format: "Markdown",
  });

  const markdown = await page.getByTestId("documentation-preview-text").innerText();

  expect(markdown.startsWith("# Docs Demo API")).toBe(true);
  expect(markdown).toContain("**Version:** 3.2.1");
  expect(markdown).toContain("### `GET` /__docs/invoices");
  expect(markdown).toContain("### `DELETE` /__docs/invoices/{invoiceId} _(deprecated)_");
  expect(markdown).toContain(
    "| Name | In | Type | Required | Default | Example | Constraints | Description |",
  );
  expect(markdown).toContain("- **200** — A list of invoices.");
  expect(markdown).toContain("Authorization: Bearer {{token}}");
  expect(markdown).toContain("Account → see Account");

  // No timestamp, so the same specification produces the same file (spec §33).
  expect(markdown).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

  // Regenerating produces byte-identical output.
  await page.getByTestId("generate-documentation").click();
  expect(await page.getByTestId("documentation-preview-text").innerText()).toBe(markdown);
});

// ---------------------------------------------------------------------------
// 9. HTML export
// ---------------------------------------------------------------------------

test("9: exports a static HTML page and its stylesheet asset", async ({ page }) => {
  await importSpecification(page, DOCS_SPEC);
  const dialog = await generate(page, {
    source: "OpenAPI specification",
    specificationLabel: DOCS_SPEC_LABEL,
  });

  // Collected through an event listener rather than two `waitForEvent` calls:
  // both of those resolve on whichever download arrives first, so they would
  // return the same file twice.
  const downloads: Array<{ name: string; path: string | null }> = [];
  page.on("download", (download) => {
    void download.path().then((path) => {
      downloads.push({ name: download.suggestedFilename(), path });
    });
  });

  await dialog.getByTestId("export-documentation").click();
  await expect.poll(() => downloads.length).toBe(2);

  const names = downloads.map((download) => download.name).sort();
  expect(names).toEqual(["assets-styles.css", "index.html"]);

  const indexPath = downloads.find((download) => download.name === "index.html")?.path;
  expect(indexPath).toBeTruthy();

  const { readFile } = await import("node:fs/promises");
  const html = await readFile(indexPath as string, "utf8");

  expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  expect(html).toContain("<title>Docs Demo API</title>");
  expect(html).toContain("List invoices");
  // Self-contained: styles are inlined too, so the file works opened alone.
  expect(html).toContain("<style>");
  // Nothing external, so it works offline from a file:// URL.
  expect(html).not.toMatch(/<script[^>]+src=/);
  expect(html).not.toMatch(/<link[^>]+href=["']https?:/);
});

// ---------------------------------------------------------------------------
// 10. Search
// ---------------------------------------------------------------------------

test("10: searches endpoints inside the generated page, with no server", async ({ page }) => {
  await importSpecification(page, DOCS_SPEC);
  await generate(page, {
    source: "OpenAPI specification",
    specificationLabel: DOCS_SPEC_LABEL,
  });

  const frame = preview(page);
  const search = frame.getByTestId("doc-search");
  await expect(search).toBeVisible();

  // By path. Matching is a plain substring scan, so "accounts" finds the
  // endpoint but not the singular `Account` schema.
  await search.fill("accounts");
  await expect(frame.getByTestId("search-result")).toHaveCount(1);
  await expect(frame.getByTestId("search-result").first()).toContainText("/__docs/accounts");

  // …and the singular stem finds both the endpoint and the schema.
  await search.fill("account");
  await expect(frame.getByTestId("search-result")).toHaveCount(2);

  // By method.
  await search.fill("delete");
  await expect(frame.getByTestId("search-result").first()).toContainText("DELETE");

  // By schema name.
  await search.fill("address");
  await expect(frame.getByTestId("search-result").first()).toContainText("Address");

  // By auth scheme.
  await search.fill("bearerauth");
  expect(await frame.getByTestId("search-result").count()).toBeGreaterThan(0);

  // No match says so rather than showing a stale list.
  await search.fill("zzzzznotathing");
  await expect(frame.getByTestId("search-result")).toHaveCount(0);
  await expect(frame.locator("#search-empty")).toHaveText("No matches.");
});

// ---------------------------------------------------------------------------
// 11. Contract coverage
// ---------------------------------------------------------------------------

test("11: shows contract coverage as labelled QA metadata", async ({ page }) => {
  await seedCollection(page, [
    { name: "List invoices", method: "GET", url: "http://localhost:4010/__docs/invoices" },
  ]);
  await importSpecification(page, DOCS_SPEC);

  await generate(page, {
    source: "OpenAPI + Collection",
    specificationLabel: DOCS_SPEC_LABEL,
    collectionLabel: COLLECTION_NAME,
    sections: { "Contract status": true },
  });

  const frame = preview(page);
  const coverage = frame.getByTestId("doc-coverage");

  await expect(coverage).toBeVisible();
  await expect(coverage).toContainText("Documented operations: 5");
  await expect(coverage).toContainText("Operation coverage: 1");

  // Spec §21: labelled as QA metadata, and explicitly not a quality claim.
  await expect(frame.locator("#contract-status")).toContainText(
    "not a measure of API quality",
  );
});

// ---------------------------------------------------------------------------
// 12. Drift
// ---------------------------------------------------------------------------

test("12: shows contract drift between the collection and the specification", async ({ page }) => {
  await seedCollection(page, [
    { name: "List invoices", method: "GET", url: "http://localhost:4010/__docs/invoices" },
    { name: "Internal metrics", method: "GET", url: "http://localhost:4010/__docs/internal/metrics" },
  ]);
  await importSpecification(page, DOCS_SPEC);

  await generate(page, {
    source: "OpenAPI + Collection",
    specificationLabel: DOCS_SPEC_LABEL,
    collectionLabel: COLLECTION_NAME,
    sections: { "Contract status": true },
  });

  const frame = preview(page);
  const drift = frame.getByTestId("doc-drift");

  await expect(drift).toBeVisible();
  await expect(drift).toContainText("Aligned: 1");
  await expect(drift).toContainText("Missing from specification: 1");
  await expect(drift).toContainText("Missing from collection: 4");

  // The undocumented endpoint is named, not merely counted.
  await expect(frame.locator("#contract-status")).toContainText("/__docs/internal/metrics");

  // Per-endpoint status is shown too, when the section is on (spec §20).
  await expect(
    frame.locator("#get-docs-invoices").getByTestId("endpoint-contract-status"),
  ).toContainText("aligned");
});
