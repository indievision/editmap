import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5174",
    channel: "chrome",
    viewport: { width: 1440, height: 1000 },
  },
  workers: 1,
});
