import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const GROQ = `http://127.0.0.1:${process.env.E2E_GROQ_PORT || 3101}`;

async function demo(page: Page) {
  await page.goto("/app#demo");
  await page.getByRole("button", { name: "Analyze repository", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Start here:/ })).toBeVisible();
}

const panel = (page: Page) => page.getByRole("complementary", { name: "OTTER" });
const replies = (page: Page) => panel(page).getByRole("article", { name: "OTTER reply" });

async function openOtter(page: Page) {
  if (!(await panel(page).isVisible())) await page.getByRole("button", { name: "Open OTTER" }).click();
  await expect(panel(page)).toBeVisible();
}

async function section(page: Page, name: string) {
  const narrow = page.viewportSize()!.width < 768;
  if (narrow && (await panel(page).isVisible()))
    await panel(page).getByRole("button", { name: "Close OTTER" }).click();
  if (narrow) await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
}

async function ask(page: Page, question: string) {
  await panel(page).getByRole("textbox", { name: "Message OTTER" }).fill(question);
  await panel(page).getByRole("button", { name: "Send message" }).click();
}

async function groqRequests(request: APIRequestContext) {
  return (await (await request.get(`${GROQ}/__requests`)).json()) as {
    question: string;
    context: any;
  }[];
}

test("global OTTER is on every section, keeps its conversation and receives page context", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await demo(page);
  for (const name of ["Risks", "Dependencies", "Ripple Graph", "Coverage", "Evidence", "Overview"]) {
    await section(page, name);
    await expect(page.getByRole("button", { name: "Open OTTER" })).toBeVisible();
  }

  await openOtter(page);
  await expect(panel(page)).toContainText("OTTER sees: Overview");
  await expect(panel(page).locator('input[type="file"]')).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: /camera|attach|image/i })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "What should I investigate first?" }).click();
  await expect(replies(page).first()).toContainText("Global answer on Overview");
  await expect(replies(page).first()).toContainText("Based on synthetic demo data");

  await section(page, "Applications");
  await page.getByRole("button", { name: "Ask OTTER about checkout-api" }).click();
  await expect(panel(page)).toContainText("OTTER sees: Applications · checkout-api");
  await expect(replies(page)).toHaveCount(1);
  await ask(page, "Which vulnerable packages affect this application? [global-e2e]");
  await expect(replies(page).nth(1)).toContainText("Global answer on Applications for checkout-api");

  const sent = (await groqRequests(request)).find((r) => r.question.includes("[global-e2e]"))!;
  expect(sent.context.currentPage.section).toBe("Applications");
  expect(sent.context.pageFocus.selectedApplication.name).toBe("checkout-api");
  expect(sent.context.focusedInvestigation).toBeUndefined();

  await replies(page).nth(1).getByRole("button", { name: "Open Coverage" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Coverage" })).toBeVisible();
  await openOtter(page);
  await expect(replies(page)).toHaveCount(2);

  const bundle = await page.evaluate(async () => {
    const sources = [...document.scripts].map((s) => s.src).filter(Boolean);
    return (await Promise.all(sources.map((src) => fetch(src).then((r) => r.text())))).join("");
  });
  expect(bundle).not.toContain("e2e-groq-key");
  expect(await page.content()).not.toContain("e2e-groq-key");
  expect(errors).toEqual([]);
});

test("vulnerability brief opens an isolated focused branch and global chat survives", async ({
  page,
  request,
}, info) => {
  await demo(page);
  await openOtter(page);
  await panel(page).getByRole("button", { name: "Explain this scan simply" }).click();
  await expect(replies(page).first()).toContainText("Global answer on Overview");

  await section(page, "Vulnerabilities");
  await page
    .getByRole("button", { name: "Open Vulnerability Brief for DEMO-005 in org.apache.logging.log4j:log4j-core" })
    .click();
  const brief = page.getByRole("region", { name: "Vulnerability Brief for DEMO-005" });
  await expect(brief).toContainText("Remote code execution in a logging component");
  await expect(brief).toContainText("How it reaches them");
  await expect(brief).not.toContainText("DEMO-001");
  await expect(brief).toContainText("Synthetic demo fixture");
  await page.screenshot({ path: `test-results/${info.project.name}-otter-brief.png` });

  await brief.getByRole("button", { name: "Ask OTTER about this vulnerability" }).click();
  const focus = panel(page).getByLabel("Investigation focus");
  await expect(focus).toContainText("DEMO-005");
  await expect(focus).toContainText("org.apache.logging.log4j:log4j-core@2.14.1");

  await ask(page, "Why is its priority high? [focused-e2e]");
  await expect(replies(page).first()).toContainText("Focused answer about DEMO-005");
  const sent = (await groqRequests(request)).find((r) => r.question.includes("[focused-e2e]"))!;
  const context = JSON.stringify(sent.context);
  expect(context).toContain("DEMO-005");
  for (const other of ["DEMO-001", "DEMO-002", "DEMO-003", "DEMO-004"])
    expect(context).not.toContain(other);

  const before = (await groqRequests(request)).length;
  await ask(page, "What other vulnerabilities exist?");
  await expect(replies(page).nth(1)).toContainText("This conversation is focused on");
  await expect(replies(page).nth(1).getByRole("button", { name: "Ask in global OTTER" })).toBeVisible();
  expect((await groqRequests(request)).length).toBe(before);

  await panel(page).getByRole("button", { name: "Record a voice question" }).click();
  await panel(page).getByRole("button", { name: "Stop recording" }).click({ delay: 1500 });
  const input = panel(page).getByRole("textbox", { name: "Message OTTER" });
  await expect(input).toHaveValue("Which applications are affected?");
  await input.fill("Which applications are affected, briefly?");
  await expect(input).toHaveValue("Which applications are affected, briefly?");
  await page.screenshot({ path: `test-results/${info.project.name}-otter-focused.png` });

  await panel(page).getByRole("button", { name: "Back to global OTTER" }).click();
  await expect(replies(page)).toHaveCount(1);
  await expect(replies(page).first()).toContainText("Global answer on Overview");
  await expect(panel(page).getByRole("navigation", { name: "OTTER conversations" })).toContainText(
    "DEMO-005",
  );

  await panel(page)
    .getByRole("button", { name: /Open focused investigation DEMO-005/ })
    .click();
  await expect(replies(page)).toHaveCount(2);
  await expect(input).toHaveValue("Which applications are affected, briefly?");
  await replies(page).first().getByRole("button", { name: /^Trace Ripple from/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ripple Graph" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Ripple traced: affects 2 of 4 projects/ })).toBeVisible();
});

test("voice permission denial and transcription failure are reported truthfully", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__denyMic = true;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) =>
      (window as any).__denyMic
        ? Promise.reject(new DOMException("Permission denied", "NotAllowedError"))
        : original(constraints);
  });
  await demo(page);
  await openOtter(page);
  const input = panel(page).getByRole("textbox", { name: "Message OTTER" });
  await panel(page).getByRole("button", { name: "Record a voice question" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("Microphone permission was denied");
  await expect(input).toHaveValue("");

  await page.evaluate(() => {
    (window as any).__denyMic = false;
  });
  await page.route("**/api/v1/otter/transcribe", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Groq could not complete the transcription request." }),
    }),
  );
  await panel(page).getByRole("button", { name: "Record a voice question" }).click();
  await panel(page).getByRole("button", { name: "Stop recording" }).click({ delay: 1500 });
  await expect(panel(page).getByRole("alert")).toContainText(
    "Transcription failed: Groq could not complete the transcription request.",
  );
  await expect(input).toHaveValue("");
});
