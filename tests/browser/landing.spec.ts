import { test, expect } from "@playwright/test";
test("landing page renders, scrolls and routes into the workspace", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /See the risk/ })).toBeVisible();
  await expect(page.getByText(/Source-backed dependency intelligence/)).toBeVisible();
  // Tailwind utilities must win over the dashboard stylesheet's unlayered element rules.
  await expect(page.getByRole("button", { name: "Open app", exact: true })).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  // The hero must not be pinned to one viewport on desktop, and no CTA may be inert.
  if (testInfo.project.name === "desktop") {
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 4),
    ).toBeTruthy();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  }
  expect(
    await page.evaluate(
      () =>
        [...document.querySelectorAll("a")].filter(
          (a) => !a.getAttribute("href") || a.getAttribute("href") === "#",
        ).length,
    ),
  ).toBe(0);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-landing.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open app", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start with your repository." })).toBeVisible();
  expect(errors).toEqual([]);
});
test("hero CTAs reach the demo and the methodology write-up", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "How scoring works" }).click();
  await expect(page).toHaveURL(/#methodology$/);
  await expect(page.getByText("From a package to the services it reaches")).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the demo" }).click();
  await expect(page.getByRole("heading", { name: "Your repository, understood." })).toBeVisible();
});
