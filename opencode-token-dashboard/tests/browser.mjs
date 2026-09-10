import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { createDashboardServer } from "../server/http.mjs";
import { fixture, NOW } from "../server/test-fixture.mjs";

test("dashboard browser workflows against a temporary database", async (t) => {
  const database = fixture(t);
  for (let index = 0; index < 14; index++) {
    database.session(`extra-${index}`, "p1", "2026-09-08");
    database.assistant(
      `extra-${index}`,
      `extra-${index}`,
      "2026-09-08",
      "provider/a",
      index * 100,
      20,
      5,
      100,
    );
  }
  database.db
    .prepare("UPDATE session SET title = ? WHERE id = ?")
    .run('=HYPERLINK("bad")', "main");
  const server = await createDashboardServer({
    dbPath: database.path,
    now: () => NOW,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  const externalRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith(base) && !request.url().startsWith("data:"))
      externalRequests.push(request.url());
  });
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  async function loaded() {
    await page.locator('.dashboard-content[aria-busy="false"]').waitFor();
  }
  async function select(label, value) {
    const response = page.waitForResponse((response) =>
      response.url().includes("/api/dashboard?"),
    );
    await page.getByLabel(label, { exact: true }).selectOption(value);
    await response;
    await loaded();
  }

  await t.test(
    "production loads real fixture totals without external requests",
    async () => {
      await page.goto(base);
      await loaded();
      const data = await (await fetch(`${base}/api/dashboard`)).json();
      assert.equal(
        await page.locator(".stat-featured .stat-value").getAttribute("title"),
        data.summary.tokens.total.toLocaleString("en-US"),
      );
      assert.equal(await page.locator(".session-table tbody tr").count(), 6);
      assert.equal(
        await page.locator(".connection-badge").innerText(),
        "Local connection",
      );
      assert.deepEqual(externalRequests, []);
    },
  );

  await t.test(
    "date, model, and project filters stay in the URL and reconcile totals",
    async () => {
      await select("Date range", "all");
      assert.match(page.url(), /range=all/);
      await select("Filter by model", "other/b");
      assert.equal(await page.locator(".session-table tbody tr").count(), 2);
      await select("Filter by project", "p2");
      assert.equal(await page.locator(".session-table tbody tr").count(), 1);
      assert.equal(
        await page.locator(".stat-featured .stat-value").getAttribute("title"),
        "80",
      );
      await page.reload();
      await loaded();
      assert.equal(
        await page.getByLabel("Filter by model", { exact: true }).inputValue(),
        "other/b",
      );
      assert.equal(
        await page
          .getByLabel("Filter by project", { exact: true })
          .inputValue(),
        "p2",
      );
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await loaded();
      await select("Date range", "30d");
    },
  );

  await t.test(
    "pagination, search, sorting, and keyboard session inspection",
    async () => {
      const first = await page.locator(".session-title").first().innerText();
      await page
        .getByRole("button", { name: "Next page", exact: true })
        .click();
      assert.notEqual(
        await page.locator(".session-title").first().innerText(),
        first,
      );
      await page
        .getByLabel("Search sessions", { exact: true })
        .fill("no-such-session");
      await page
        .getByRole("heading", { name: "No sessions match your search" })
        .waitFor();
      await page
        .getByRole("button", { name: "Clear search", exact: true })
        .first()
        .click();
      await page.getByLabel("Sort sessions").selectOption("tokens");
      await page.locator(".session-title").first().focus();
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").waitFor();
      assert.match(
        await page.getByRole("dialog").innerText(),
        /Token breakdown/,
      );
      await page.getByText("Session metadata", { exact: true }).click();
      assert.match(await page.getByRole("dialog").innerText(), /Session ID/);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(
        await page.evaluate(() => document.activeElement?.className),
        "session-title",
      );
    },
  );

  await t.test(
    "CSV export respects search and neutralizes spreadsheet formulas",
    async () => {
      await page
        .getByLabel("Search sessions", { exact: true })
        .fill("HYPERLINK");
      await page.waitForFunction(
        () => document.querySelectorAll(".session-table tbody tr").length === 1,
      );
      const pending = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export CSV", exact: true })
        .click();
      const download = await pending;
      const csv = await readFile(await download.path(), "utf8");
      assert.equal(csv.split("\r\n").length, 2);
      assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
      assert.ok(csv.includes("Reasoning (separate)"));
      await page
        .getByRole("button", { name: "Clear search", exact: true })
        .first()
        .click();
    },
  );

  await t.test(
    "chart metrics, model legend, navigation and source details work",
    async () => {
      await page.getByRole("button", { name: "Cost", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "Cost", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.match(
        await page.locator(".chart-summary").innerText(),
        /recorded in USD/,
      );
      await page.getByRole("button", { name: "Tokens", exact: true }).click();
      const legend = page.locator(".chart-legend button").first();
      await legend.click();
      assert.equal(await legend.getAttribute("aria-pressed"), "false");
      await legend.click();
      await page
        .getByRole("button", { name: "Explore models", exact: true })
        .click();
      await page.getByRole("heading", { name: "Model breakdown" }).waitFor();
      assert.ok((await page.locator(".model-breakdown tbody tr").count()) >= 3);
      const modelAudit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        modelAudit.violations.map((item) => item.id),
        [],
      );
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Data source", exact: true })
        .click();
      assert.match(
        await page.locator(".source-panel").innerText(),
        /Connected, read-only/,
      );
      assert.ok(
        (await page.locator(".source-panel").innerText()).includes(
          database.path,
        ),
      );
      await page
        .getByRole("button", { name: "A note on the numbers", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      assert.match(
        await page.getByRole("dialog").innerText(),
        /not an invoice/,
      );
      const helpAudit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        helpAudit.violations.map((item) => item.id),
        [],
      );
      await page.getByRole("button", { name: "Close dialog" }).click();
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Overview", exact: true })
        .click();
    },
  );

  await t.test(
    "desktop and mobile layouts have no page overflow and pass accessibility checks",
    async () => {
      for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(100);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `Page overflow at ${width}px`,
        );
        if (width === 390 || width === 1440) {
          const audit = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze();
          assert.deepEqual(
            audit.violations.map((item) => ({
              id: item.id,
              nodes: item.nodes.map((node) => node.target),
            })),
            [],
            `Accessibility at ${width}px`,
          );
        }
      }
      await page
        .getByRole("navigation", { name: "Mobile navigation" })
        .getByRole("button", { name: "Sessions", exact: true })
        .click();
      await page.getByRole("heading", { name: "All sessions" }).waitFor();
      assert.equal(await page.locator(".session-table tbody tr").count(), 12);
      assert.equal(
        await page.locator(".session-table .token-cell").first().isVisible(),
        true,
      );
      await page.locator(".session-title").first().click();
      await page.getByRole("dialog").waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.getByRole("button", { name: "Close dialog" }).click();
    },
  );

  await t.test(
    "missing database and server errors are honest, with recovery controls",
    async () => {
      const missing = await createDashboardServer({
        dbPath: join(database.directory, "missing.db"),
        now: () => NOW,
      });
      missing.listen(0, "127.0.0.1");
      await once(missing, "listening");
      try {
        await page.goto(`http://127.0.0.1:${missing.address().port}`);
        await page
          .getByRole("heading", {
            name: "Your dashboard is ready for OpenCode",
          })
          .waitFor();
        assert.equal(await page.locator(".stats-grid").count(), 0);
        assert.equal(
          await page.getByRole("button", { name: "Export CSV" }).isDisabled(),
          true,
        );
        await page
          .getByRole("button", { name: "Connection details", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Your data. Your machine." })
          .waitFor();
      } finally {
        missing.closeAllConnections();
        await new Promise((resolve) => missing.close(resolve));
      }
      await page.route("**/api/dashboard?*", (route) =>
        route.abort("connectionrefused"),
      );
      await page.goto(base);
      await page.getByRole("alert").waitFor();
      assert.match(
        await page.getByRole("alert").innerText(),
        /couldn't refresh/,
      );
      await page.unroute("**/api/dashboard?*");
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .click();
      await loaded();
      assert.equal(await page.getByRole("alert").count(), 0);
      assert.deepEqual(pageErrors, []);
    },
  );
});
