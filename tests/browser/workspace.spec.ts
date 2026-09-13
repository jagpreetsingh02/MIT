import { test, expect } from "@playwright/test";
async function demo(page: import("@playwright/test").Page) {
  await page.goto("/app#demo");
  await expect(page.getByRole("heading", { name: "Your repository, understood." })).toBeVisible();
  await expect(page.getByText("4 of 4 selected")).toBeVisible();
  await page.getByRole("button", { name: "Analyze repository", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Start here:/ })).toBeVisible();
}
test("complete offline map, priority, path, ripple, inventory, export and reload journey", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await demo(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: `test-results/${info.project.name}-overview.png`, fullPage: true });
  await page.getByRole("button", { name: "Trace Ripple", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: /Ripple traced: affects 3 of 4 projects/ }),
  ).toBeVisible();
  await expect(page.getByText(/4 dependency paths ·/)).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: `test-results/${info.project.name}-ripple.png`, fullPage: true });
  await page.getByRole("button", { name: "Clear simulation" }).click();
  await page.getByRole("button", { name: "View all dependencies" }).click();
  await page.getByRole("textbox", { name: "Search dependencies" }).fill("lodash");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Inspect lodash", exact: true }).click();
  await expect(page.getByRole("heading", { name: "lodash", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SBOM" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.spdx\.json$/);
  await page.reload();
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
  await expect(page.getByText("projects mapped", { exact: false })).toContainText("1");
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
