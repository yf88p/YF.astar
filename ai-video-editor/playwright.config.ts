import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const baseURL = "http://localhost:3101";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
  }],
  webServer: {
    command: "npm run dev -- --port 3101 --hostname 127.0.0.1",
    // Readiness must not bootstrap the expensive sample project.
    url: `${baseURL}/api/editor/projects`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      DATA_DIR: path.resolve(".test-data/browser"),
      FIXTURE_MODE: "true",
      SONIOX_API_KEY: "",
      EDITOR_PASSWORD: "",
      MEDIA_MAX_BYTES: String(16 * 1024 * 1024),
      MEDIA_MAX_DURATION_SECONDS: "30",
      MEDIA_MAX_PIXELS: String(1920 * 1080),
      RENDER_MAX_DURATION_SECONDS: "30",
      STORAGE_MAX_BYTES: String(1024 * 1024 * 1024),
      FFMPEG_TIMEOUT_MS: "120000",
    },
  },
});
