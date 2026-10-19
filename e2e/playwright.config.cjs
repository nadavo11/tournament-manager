const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: ".",
  testMatch: "*.spec.cjs",
  timeout: 180000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "evidence/results.json" }],
    ["html", { outputFolder: "evidence/report", open: "never" }],
  ],
  use: {
    baseURL: process.env.DEMO_URL || "http://127.0.0.1:8400",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
  outputDir: "test-results",
});
