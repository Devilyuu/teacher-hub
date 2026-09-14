import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: baseURL ?? "http://127.0.0.1:0",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
});
