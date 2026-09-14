import { test, expect, type Page } from "@playwright/test";

async function section(page: Page, name: string) {
  if (await page.getByRole("button", { name: "Open navigation" }).isVisible())
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
}

async function demo(page: Page) {
  await page.goto("/app#demo");
  await expect(page.getByRole("heading", { name: "Your repository, understood." })).toBeVisible();
  await expect(page.getByText("4 of 4 selected")).toBeVisible();
  await page.getByRole("button", { name: "Analyze repository", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Start here:/ })).toBeVisible();
}

test("complete offline map, overview, ripple, sections, export and reload journey", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await demo(page);
  await expect(page.getByRole("region", { name: "Repository context" })).toContainText(
    "Demo snapshot",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: `test-results/${info.project.name}-overview.png`, fullPage: true });

  await page.getByRole("button", { name: "Trace Ripple", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Ripple Graph" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Ripple traced: affects 3 of 4 projects/ }),
  ).toBeVisible();
  await expect(page.getByText(/4 dependency paths ·/)).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: `test-results/${info.project.name}-ripple.png`, fullPage: true });
  await page.getByRole("button", { name: "Clear simulation" }).click();

  await section(page, "Risks");
  await expect(page.locator("tbody tr")).toHaveCount(5);

  await section(page, "Vulnerabilities");
  await expect(page.locator("tbody")).toContainText("DEMO-005");

  await section(page, "Applications");
  await expect(page.getByRole("article")).toHaveCount(4);

  await section(page, "Coverage");
  await expect(page.getByText("Analysis coverage by project")).toBeVisible();

  await section(page, "Evidence");
  await expect(page.getByText("RootLine demo fixture").first()).toBeVisible();

  await section(page, "Dependencies");
  await page.getByRole("textbox", { name: "Search dependencies" }).fill("lodash");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Inspect lodash", exact: true }).click();
  await expect(page.getByRole("heading", { name: "lodash", exact: true })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SBOM" }).click();
  expect((await download).suggestedFilename()).toMatch(/^rootline-.*\.spdx\.json$/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Ripple Graph" })).toBeVisible();
  await section(page, "Overview");
  await expect(page.getByRole("heading", { name: /Start here:/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("repository map allows selection and display rename", async ({ page }, info) => {
  await page.goto("/app#demo");
  await expect(page.getByRole("button", { name: "Analyze repository" })).toBeVisible();
  await page.getByRole("button", { name: "Deselect all" }).click();
  await expect(page.getByRole("button", { name: "Analyze repository" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Analyze storefront", exact: true }).check();
  await page
    .getByRole("textbox", { name: "Display name for apps/storefront", exact: true })
    .fill("My shop");
  await page.screenshot({
    path: `test-results/${info.project.name}-repository-map.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Analyze repository" }).click();
  await expect(page.getByRole("region", { name: "Analysis summary" })).toContainText(
    "Applications1projects mapped",
  );
  await page.getByRole("button", { name: "Trace Ripple", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: /affects 1 of 1 projects/ })).toBeVisible();
});

test("invalid repository can be corrected without losing the form", async ({ page }) => {
  await page.goto("/app#new");
  await page.getByLabel("Repository URL").fill("https://localhost/private");
  await page.getByRole("button", { name: "Map repository" }).click();
  await expect(page.getByRole("alert")).toContainText("canonical GitHub");
  await expect(page.getByLabel("Repository URL")).toHaveValue("https://localhost/private");
});

test("unresolved declarations remain visible in map, overview and dependencies", async ({
  page,
}) => {
  await page.goto("/app#new");
  await page.getByRole("button", { name: "Dependency file", exact: true }).click();
  await page.getByLabel("Filename", { exact: true }).fill("pyproject.toml");
  await page.getByLabel("File content").fill('[project]\ndependencies=["requests>=2.31","numpy"]');
  await page.getByRole("button", { name: "Map repository", exact: true }).click();
  await expect(page.getByText("Detected dependencies: 2", { exact: false })).toBeVisible();
  await expect(page.getByText("Coverage: DECLARED_ONLY", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Analyze repository", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("2 dependencies were discovered");
  await expect(page.getByRole("region", { name: "Analysis summary" })).toContainText(
    "2 dependencies discovered",
  );
  await section(page, "Dependencies");
  await page.getByRole("textbox", { name: "Search dependencies" }).fill("requests");
  await expect(page.locator("tbody")).toContainText(">=2.31");
  await expect(page.locator("tbody")).toContainText("Not checked");
  await expect(page.locator("tbody")).toContainText("Not scored");
});
