import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch(process.env.PW_CHROME ? { channel: "chrome" } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto((process.env.VERIFY_BASE || "http://127.0.0.1:3000") + "/app#new");
  await page
    .getByLabel("Repository URL")
    .fill("https://github.com/GoogleCloudPlatform/microservices-demo");
  await page.getByRole("button", { name: "Map repository", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your repository, understood." })).toBeVisible({
    timeout: 120000,
  });
  await page.getByRole("button", { name: "Analyze repository", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Start here:/ })).toBeVisible({ timeout: 300000 });
  await page.getByRole("button", { name: "Trace Ripple", exact: true }).first().click();
  const impact = page.getByRole("heading", { name: /Ripple traced: affects/ });
  await expect(impact).toBeVisible();
  await expect(page.locator('.package-details a[href^="https://osv.dev/"]').first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/live-github-ripple.png" });
  const report = {
    verifiedAt: new Date().toISOString(),
    repository: "GoogleCloudPlatform/microservices-demo",
    journey: "GitHub URL → Repository Map → Analyze → source-backed finding → Trace Ripple",
    impact: await impact.innerText(),
    browserErrors: errors,
  };
  await mkdir("docs/verification", { recursive: true });
  await writeFile("docs/verification/live-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
