import { defineConfig } from "@playwright/test";

// Chromium is preinstalled under PLAYWRIGHT_BROWSERS_PATH; never run `playwright install` here.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    viewport: { width: 1100, height: 900 },
  },
  webServer: {
    command: "npx vite --port 5173 --strictPort",
    url: "http://localhost:5173/?src=fixture",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
