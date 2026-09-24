import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  timeout: 15_000,
  webServer: [
    {
      command: "npm --prefix ../.. run dev",
      reuseExistingServer: true,
      url: "http://127.0.0.1:7070/health",
    },
    {
      command: "npm run dev -- --host 127.0.0.1",
      reuseExistingServer: true,
      url: "http://127.0.0.1:4173",
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    channel: "chrome",
    screenshot: "only-on-failure",
  },
});
