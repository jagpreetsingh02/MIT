import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.E2E_PORT || 3100);
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  fullyParallel: false,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROME ? { channel: "chrome" } : {},
  },
  webServer: {
    command: "npm start",
    env: {
      PORT: String(port),
      DB_PATH: "data/browser-tests.sqlite",
      NODE_ENV: "test",
      API_TOKEN: "",
    },
    url: `http://127.0.0.1:${port}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 30000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
