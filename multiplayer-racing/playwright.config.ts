import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/browser.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    viewport: { width: 1440, height: 1020 },
    launchOptions: {
      args: [
        "--enable-webgl",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--disable-dev-shm-usage",
      ],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "PORT=3100 HOST=127.0.0.1 PUBLIC_URL=http://127.0.0.1:3100 npm start",
    url: "http://127.0.0.1:3100/ready",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
