import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.E2E_PORT || 3100);
const groqPort = Number(process.env.E2E_GROQ_PORT || 3101);
const media = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  fullyParallel: false,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    launchOptions: { args: media, ...(process.env.PW_CHROME ? { channel: "chrome" } : {}) },
  },
  webServer: [
    {
      command: "node --import tsx tests/browser/mock-groq.ts",
      env: { E2E_GROQ_PORT: String(groqPort) },
      url: `http://127.0.0.1:${groqPort}/__requests`,
      reuseExistingServer: false,
      timeout: 15000,
    },
    {
      command: "npm start",
      env: {
        PORT: String(port),
        DB_PATH: "data/browser-tests.sqlite",
        NODE_ENV: "test",
        API_TOKEN: "",
        SCAN_RATE_LIMIT_PER_MINUTE: "60",
        GROQ_API_KEY: "e2e-groq-key",
        GROQ_BASE_URL: `http://127.0.0.1:${groqPort}`,
      },
      url: `http://127.0.0.1:${port}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
