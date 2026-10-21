const { defineConfig } = require("@playwright/test");
const path = require("node:path");
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "public-startup.spec.cjs",
  timeout: 30000,
  expect: { timeout: 8000 },
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:18766", headless: true },
  webServer: {
    command: `python3 "${path.join(__dirname, "serve-public-ui.py")}" "${path.resolve(process.env.PUBLIC_UI_DIR || path.join(__dirname, "../backend/live-ui"))}"`,
    url: "http://127.0.0.1:18766",
  },
});
