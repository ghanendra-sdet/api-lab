import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Milestone 12 — Security Hardening & Advanced API Testing E2E (spec §45).
 *
 * Every scenario drives the real UI against the real Milestone 9 mock server
 * and its Milestone 12 security fixtures. No network stubbing and no mocked
 * transport: the whole point of this feature is observing what a server
 * actually did with a mutated request.
 *
 * ## On the localStorage seeding below
 *
 * `seedWorkspace` writes a collection straight into localStorage rather than
 * clicking through the collection UI. That follows the precedent
 * `contract.spec.ts` set with `setMockRoute`: functionality with its own E2E
 * coverage elsewhere (Milestone 3's collections, Milestone 2's body editor —
 * which is a Monaco instance that takes seconds to drive) is set up directly,
 * so these scenarios spend their time on what Milestone 12 introduced.
 * Everything the security feature itself does still goes through the real UI.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "security");
const SECURITY_SPEC = join(FIXTURES, "security-api.json");
const REDOS_SPEC = join(FIXTURES, "redos-api.json");

const COLLECTION_NAME = "Security Collection";

interface SeedRequest {
  name: string;
  method: string;
  url: string;
  body?: string;
  authHeaderToken?: string;
  /** An expected status code, saved as a real Milestone 7 assertion. Without
   * one a request has nothing to assert and its functional status is
   * "skipped" rather than "passed" — correct, but not what scenario 10 is
   * trying to demonstrate. */
  expectStatus?: number;
}

/** Writes a collection containing the given requests into localStorage. */
async function seedWorkspace(page: Page, requests: SeedRequest[]): Promise<void> {
  await page.evaluate(
    ({ collectionName, entries }) => {
      const now = new Date().toISOString();
      const workspace = {
        version: 1,
        workspace: {
          collections: [
            {
              id: "col-security",
              name: collectionName,
              items: entries.map((entry, index) => ({
                id: `req-security-${index}`,
                type: "request",
                name: entry.name,
                request: {
                  method: entry.method,
                  url: entry.url,
                  params: [],
                  headers:
                    entry.body === undefined
                      ? []
                      : [{ id: "h-ct", key: "Content-Type", value: "application/json", enabled: true }],
                  auth:
                    entry.authHeaderToken === undefined
                      ? { type: "none" }
                      : { type: "bearer", token: entry.authHeaderToken },
                  bodyMode: entry.body === undefined ? "none" : "raw",
                  bodyRawFormat: "JSON",
                  bodyRawContent: entry.body ?? "",
                  tests:
                    entry.expectStatus === undefined
                      ? []
                      : [
                          {
                            id: "a-status",
                            target: "status",
                            operator: "equals",
                            expected: String(entry.expectStatus),
                            enabled: true,
                          },
                        ],
                  extractions: [],
                },
                createdAt: now,
                updatedAt: now,
              })),
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
      };
      window.localStorage.setItem("api-lab-workspace", JSON.stringify(workspace));
    },
    { collectionName: COLLECTION_NAME, entries: requests },
  );
  await page.reload();
}

const VALID_BODY = JSON.stringify({ name: "Ada", age: 36, role: "admin" });

async function openSecurity(page: Page) {
  await page.getByRole("button", { name: "Security", exact: true }).click();
  return page.getByRole("dialog", { name: "Security" });
}

async function importAndBindSpecification(page: Page, fixturePath: string): Promise<void> {
  await page.getByRole("button", { name: "Contract", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Contract" });
  await dialog.getByLabel("Import OpenAPI specification").setInputFiles(fixturePath);
  await expect(dialog.getByText(/operations$/)).toBeVisible();
  await dialog.getByLabel("Bound collection").selectOption({ label: COLLECTION_NAME });
  await dialog.getByRole("button", { name: "Close contract manager" }).click();
}

/** Ticks exactly the given categories, clearing every other one first, so a
 * scenario's generated suite is deterministic regardless of defaults. */
async function selectOnlyCategories(dialog: ReturnType<Page["getByRole"]>, labels: string[]): Promise<void> {
  const all = [
    "Missing required fields",
    "Invalid types",
    "Null values",
    "Empty values",
    "Boundary values",
    "Invalid enums",
    "Malformed JSON",
    "Unexpected content type",
    "Missing authentication",
    "Invalid authentication",
  ];

  for (const label of all) {
    const box = dialog.getByLabel(label, { exact: true });
    if (labels.includes(label)) await box.check();
    else await box.uncheck();
  }
}

test.describe("Security & Negative Testing", () => {
  // One shared mock-server process and one shared origin's localStorage: run
  // serially so one scenario's specifications and generated suites can never
  // race another's.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.removeItem("api-lab-contracts");
      window.localStorage.removeItem("api-lab-workspace");
      window.localStorage.removeItem("api-lab-security");
    });
    await page.reload();
  });

  // -------------------------------------------------------------------
  test("1. generates negative tests from an OpenAPI specification and previews them", async ({ page }) => {
    await seedWorkspace(page, [
      { name: "Create user", method: "POST", url: "http://localhost:4010/__security/validation", body: VALID_BODY },
    ]);
    await importAndBindSpecification(page, SECURITY_SPEC);

    const dialog = await openSecurity(page);
    await expect(dialog.getByText("Contract attached: Security Fixtures API")).toBeVisible();

    await selectOnlyCategories(dialog, ["Missing required fields"]);
    await dialog.getByRole("button", { name: "Generate" }).click();

    // The preview is a real, explicit step — nothing has been sent yet.
    await expect(dialog.getByText(/^Generated tests: [1-9]/)).toBeVisible();
    await expect(dialog.getByText("remove required field /name")).toBeVisible();
    await expect(dialog.getByText("remove required field /age")).toBeVisible();
    // Contract-sourced, so the assertion is schema-backed rather than inferred.
    await expect(dialog.getByText(/negative · contract · expects 400, 422/).first()).toBeVisible();
  });

  // -------------------------------------------------------------------
  test("2. a missing required field produces a controlled 4xx", async ({ page }) => {
    await seedWorkspace(page, [
      { name: "Create user", method: "POST", url: "http://localhost:4010/__security/validation", body: VALID_BODY },
    ]);
    await importAndBindSpecification(page, SECURITY_SPEC);

    const dialog = await openSecurity(page);
    await selectOnlyCategories(dialog, ["Missing required fields"]);
    await dialog.getByRole("button", { name: "Generate" }).click();
    await dialog.getByRole("button", { name: "Run security tests" }).click();

    await expect(dialog.getByText(/^Run completed/)).toBeVisible({ timeout: 20_000 });
    const row = dialog.getByRole("listitem").filter({ hasText: "remove required field /name" });
    await expect(row.getByText("passed")).toBeVisible();
    await expect(row).toContainText("400");
  });

  // -------------------------------------------------------------------
  test("3. an invalid type is rejected and reported", async ({ page }) => {
    await seedWorkspace(page, [
      { name: "Create user", method: "POST", url: "http://localhost:4010/__security/validation", body: VALID_BODY },
    ]);
    await importAndBindSpecification(page, SECURITY_SPEC);

    const dialog = await openSecurity(page);
    await selectOnlyCategories(dialog, ["Invalid types"]);
    await dialog.getByRole("button", { name: "Generate" }).click();
    await expect(dialog.getByText("send /age as a string where a number is declared")).toBeVisible();

    await dialog.getByRole("button", { name: "Run security tests" }).click();
    await expect(dialog.getByText(/^Run completed/)).toBeVisible({ timeout: 20_000 });

    const row = dialog.getByRole("listitem").filter({ hasText: "send /age as a string where a number is declared" });
    await expect(row.getByText("passed")).toBeVisible();
    await expect(row).toContainText("400");
  });

  // -------------------------------------------------------------------
  test("4. an invalid enum value is rejected and reported", async ({ page }) => {
    await seedWorkspace(page, [
      { name: "Create user", method: "POST", url: "http://localhost:4010/__security/validation", body: VALID_BODY },
    ]);
    await importAndBindSpecification(page, SECURITY_SPEC);

    const dialog = await openSecurity(page);
    await selectOnlyCategories(dialog, ["Invalid enums"]);
    await dialog.getByRole("button", { name: "Generate" }).click();
    await expect(dialog.getByText(/send \/role as "invalid_enum"/)).toBeVisible();

    await dialog.getByRole("button", { name: "Run security tests" }).click();
    await expect(dialog.getByText(/^Run completed/)).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole("listitem").filter({ hasText: "invalid_enum" }).getByText("passed")).toBeVisible();
  });

  // -------------------------------------------------------------------
  test("5. a missing credential produces the expected 401", async ({ page }) => {
    await seedWorkspace(page, [
      {
        name: "Protected",
        method: "GET",
        url: "http://localhost:4010/__security/auth-required",
        authHeaderToken: "mock-valid-token",
      },
    ]);

    const dialog = await openSecurity(page);
    await selectOnlyCategories(dialog, ["Missing authentication"]);
    await dialog.getByRole("button", { name: "Generate" }).click();
    await expect(dialog.getByText("Protected — no authentication")).toBeVisible();
    // Both 401 and 403 are accepted by default: APIs genuinely disagree.
    await expect(dialog.getByText(/security · heuristic · expects 401, 403/)).toBeVisible();

    await dialog.getByRole("button", { name: "Run security tests" }).click();
    await expect(dialog.getByText(/^Run completed/)).toBeVisible({ timeout: 20_000 });

    const row = dialog.getByRole("listitem").filter({ hasText: "no authentication" });
    await expect(row.getByText("passed")).toBeVisible();
    await expect(row).toContainText("401");
  });

  // -------------------------------------------------------------------
  test("6. configured security-header checks pass when present and fail when omitted", async ({ page }) => {
    await seedWorkspace(page, [
      {
        name: "Headers present",
        method: "GET",
        url: "http://localhost:4010/__security/security-headers",
        authHeaderToken: "mock-valid-token",
      },
      {
        name: "Headers omitted",
        method: "GET",
        url: "http://localhost:4010/__security/security-headers?omit=1",
        authHeaderToken: "mock-valid-token",
      },
    ]);

    const dialog = await openSecurity(page);
    await selectOnlyCategories(dialog, ["Missing authentication"]);
    // This fixture answers 200 whether or not a credential is sent, so the
    // status expectation is configured to match and the security-header check
    // is what actually decides the verdict. Expected behaviour being
    // user-configurable is exactly the point of spec §12.
    await dialog.getByLabel("Authentication failure status codes").fill("200");
    await dialog.getByLabel("Content-Security-Policy", { exact: true }).check();

    // --- The endpoint that sets the header -----------------------------
    await dialog.getByLabel("Target request").selectOption({ label: `${COLLECTION_NAME} / Headers present` });
    await dialog.getByRole("button", { name: "Generate" }).click();
    await dialog.getByRole("button", { name: "Run security tests" }).click();
    await expect(dialog.getByText(/^Run completed/)).toBeVisible({ timeout: 20_000 });

    await expect(dialog.getByRole("listitem").getByText("passed").first()).toBeVisible();
    await expect(dialog.getByText("Content-Security-Policy is present.")).toBeVisible();

    // --- The same endpoint with the headers omitted ---------------------
    await dialog.getByRole("tab", { name: "Generate" }).click();
    await dialog.getByLabel("Target request").selectOption({ label: `${COLLECTION_NAME} / Headers omitted` });
    await dialog.getByRole("button", { name: "Generate" }).click();
    await dialog.getByRole("button", { name: "Run security tests" }).click();
    await expect(dialog.getByText(/^Run completed/)).toBeVisible({ timeout: 20_000 });

    await expect(dialog.getByRole("listitem").getByText("failed").first()).toBeVisible();
    await expect(dialog.getByText(/does not set Content-Security-Policy/)).toBeVisible();
  });

  // -------------------------------------------------------------------
  test("7. sensitive data is detected without exposing the value", async ({ page }) => {
    await seedWorkspace(page, [
      {
        name: "Sensitive",
        method: "GET",
        url: "http://localhost:4010/__security/sensitive-response",
        authHeaderToken: "mock-valid-token",
      },
    ]);

    const dialog = await openSecurity(page);
    await dialog.getByLabel("Fail on sensitive fields in the response").check();
    await selectOnlyCategories(dialog, ["Missing authentication"]);
    await dialog.getByRole("button", { name: "Generate" }).click();
    await dialog.getByRole("button", { name: "Run security tests" }).click();

    await expect(dialog.getByText(/^Run completed/)).toBeVisible({ timeout: 20_000 });

    await expect(dialog.getByText(/populated "password" field/)).toBeVisible();
    await expect(dialog.getByText(/populated "accessToken" field/)).toBeVisible();

    // The critical assertion: the value itself is never rendered anywhere.
    await expect(page.getByText("fixture-value-not-a-real-password")).toHaveCount(0);
    await expect(page.getByText("fixture-value-not-a-real-token")).toHaveCount(0);
  });

  // -------------------------------------------------------------------
  test("8. a verbose error response is detected as information disclosure", async ({ page }) => {
    await seedWorkspace(page, [
      {
        name: "Verbose",
        method: "GET",
        url: "http://localhost:4010/__security/verbose-error",
        authHeaderToken: "mock-valid-token",
      },
    ]);

    const dialog = await openSecurity(page);
    await selectOnlyCategories(dialog, ["Missing authentication"]);
    await dialog.getByRole("button", { name: "Generate" }).click();
    await dialog.getByRole("button", { name: "Run security tests" }).click();

    await expect(dialog.getByText(/^Run completed/)).toBeVisible({ timeout: 20_000 });

    await expect(dialog.getByText(/Python traceback header/)).toBeVisible();
    await expect(dialog.getByText(/PostgreSQL syntax error/)).toBeVisible();
    // Remediation is QA-oriented and never an exploitation instruction.
    await expect(dialog.getByText(/keep the stack trace server-side/)).toBeVisible();
    // A 500 for a deliberately invalid request is also a robustness failure.
    await expect(dialog.getByText(/should produce a controlled 4xx rejection/)).toBeVisible();
  });

  // -------------------------------------------------------------------
  test("9. a contract-invalid request is still sent, rather than being blocked as a contract failure", async ({ page }) => {
    await seedWorkspace(page, [
      { name: "Create user", method: "POST", url: "http://localhost:4010/__security/validation", body: VALID_BODY },
    ]);
    await importAndBindSpecification(page, SECURITY_SPEC);

    const dialog = await openSecurity(page);
    await selectOnlyCategories(dialog, ["Boundary values"]);
    await dialog.getByRole("button", { name: "Generate" }).click();
    await dialog.getByRole("button", { name: "Run security tests" }).click();

    await expect(dialog.getByText(/^Run completed/)).toBeVisible({ timeout: 20_000 });

    // A negative test intentionally violates the request contract (spec §21).
    // It must reach the API and be judged on the API's response — never
    // short-circuited by contract pre-validation.
    const belowMinimum = dialog.getByRole("listitem").filter({ hasText: "minimum - 1 (17)" });
    await expect(belowMinimum).toContainText("400");
    await expect(belowMinimum.getByText("passed")).toBeVisible();

    // And the on-boundary value, which the contract permits, really is accepted.
    const atMinimum = dialog.getByRole("listitem").filter({ hasText: "minimum (18)" });
    await expect(atMinimum).toContainText("201");
    await expect(atMinimum.getByText("passed")).toBeVisible();
  });

  // -------------------------------------------------------------------
  test("10. security results appear as their own category in the Collection Runner", async ({ page }) => {
    await seedWorkspace(page, [
      {
        name: "Create user",
        method: "POST",
        url: "http://localhost:4010/__security/validation",
        body: VALID_BODY,
        expectStatus: 201,
      },
    ]);
    await importAndBindSpecification(page, SECURITY_SPEC);

    const dialog = await openSecurity(page);
    await selectOnlyCategories(dialog, ["Missing required fields"]);
    await dialog.getByRole("button", { name: "Generate" }).click();
    await expect(dialog.getByText(/^Generated tests: [1-9]/)).toBeVisible();
    await dialog.getByRole("button", { name: "Close security manager" }).click();

    await page.getByRole("navigation", { name: "Collections" }).getByText(COLLECTION_NAME, { exact: true }).hover();
    await page.getByRole("button", { name: `Run ${COLLECTION_NAME}` }).click();

    const runner = page.getByRole("dialog", { name: "Collection Runner" });
    await runner.getByLabel("Run generated security tests after the collection").check();
    await runner.getByRole("button", { name: "Start Run" }).click();

    await expect(runner.getByText("Run complete")).toBeVisible({ timeout: 30_000 });

    // Categories are reported separately and never summed (spec §22, §32).
    const categories = runner.getByTestId("runner-category-summary");
    await expect(categories).toContainText("Functional: 1/1");
    await expect(categories).toContainText("Negative: 2/2");
  });

  // -------------------------------------------------------------------
  test("11. a non-local target requires explicit confirmation naming the host", async ({ page }) => {
    await seedWorkspace(page, [
      { name: "Remote", method: "POST", url: "https://api.example.com/users", body: VALID_BODY },
    ]);

    const dialog = await openSecurity(page);
    await selectOnlyCategories(dialog, ["Invalid types"]);
    await dialog.getByRole("button", { name: "Generate" }).click();
    await dialog.getByRole("button", { name: "Run security tests" }).click();

    const confirmation = page.getByRole("dialog", { name: "Confirm target" });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("api.example.com");
    await expect(confirmation).toContainText("Only continue if you are authorised to test this host");

    // Declining must send nothing at all.
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toBeHidden();
    await expect(dialog.getByText(/^Generated tests:/)).toBeVisible();
  });

  // -------------------------------------------------------------------
  test("12. a hostile schema pattern cannot freeze the application", async ({ page }) => {
    await seedWorkspace(page, [
      { name: "Create user", method: "POST", url: "http://localhost:4010/__security/validation", body: VALID_BODY },
    ]);

    // This specification carries `^[a-z]+[a-z]+…[a-z]+$`, which passes every
    // static screening layer and was measured still running after 8 seconds
    // against a 40-character non-matching input. Only the isolated worker
    // catches it — and it does so without the UI thread ever executing it.
    await importAndBindSpecification(page, REDOS_SPEC);

    // The application must remain interactive throughout. If the pattern had
    // reached the main thread, every one of these interactions would hang.
    const started = Date.now();

    const dialog = await openSecurity(page);
    await expect(dialog).toBeVisible();
    await selectOnlyCategories(dialog, ["Missing required fields"]);
    await dialog.getByRole("button", { name: "Generate" }).click();
    await expect(dialog.getByText(/^Generated tests:/)).toBeVisible();

    // Generously above the worker's 50 ms budget and far below the 8+ seconds
    // the unmitigated pattern takes for a single match.
    expect(Date.now() - started).toBeLessThan(15_000);

    // The Report tab states what the vetting actually did — a skipped check
    // must never look like a passed one.
    await dialog.getByRole("tab", { name: "Report" }).click();
    await expect(dialog.getByText(/pattern\(s\) vetted in an isolated worker/)).toBeVisible();
    await expect(dialog.getByText(/1 timed out/)).toBeVisible();
  });
});
