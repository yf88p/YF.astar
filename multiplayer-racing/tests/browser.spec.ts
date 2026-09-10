import { expect, test, type Page } from "@playwright/test";
import type { Snapshot } from "../shared/protocol";

function snapshots(page: Page) {
  const messages: Snapshot[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().endsWith("/ws")) return;
    socket.on("framereceived", ({ payload }) => {
      const value = JSON.parse(String(payload));
      if (value.type === "snapshot") {
        messages.push(value);
        if (messages.length > 200) messages.shift();
      }
    });
  });
  return messages;
}

test("two isolated browsers independently discover a room, start together, drive, and reconnect", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const first = await browser.newContext();
  const second = await browser.newContext();
  const host = await first.newPage();
  const guest = await second.newPage();
  const hostSnapshots = snapshots(host);
  const guestSnapshots = snapshots(guest);
  const errors: string[] = [];
  host.on("pageerror", (error) => errors.push(error.message));
  guest.on("pageerror", (error) => errors.push(error.message));
  await Promise.all([host.goto("/"), guest.goto("/")]);
  await expect(host.locator(".server-status")).toContainText("SERVERS ONLINE");
  await expect(guest.locator(".server-status")).toContainText("SERVERS ONLINE");
  await host.getByRole("button", { name: "Settings", exact: true }).click();
  await host.getByLabel("Driver name").fill("Alex Host");
  await host.getByRole("button", { name: "Save & back to the track" }).click();
  await guest.getByRole("button", { name: "Settings", exact: true }).click();
  await guest.getByLabel("Driver name").fill("Jordan Guest");
  await guest.getByRole("button", { name: "Save & back to the track" }).click();
  await host.getByRole("button", { name: "Create room", exact: true }).click();
  await host.getByLabel("Room name").fill("Browser network verification");
  await host.getByLabel("Laps", { exact: true }).selectOption("1");
  await host.getByLabel("Practice bots", { exact: true }).selectOption("2");
  await host.getByRole("button", { name: "Create public room" }).click();
  await expect(host.locator("[data-room-code]")).toBeVisible();
  const code = await host
    .locator("[data-room-code]")
    .getAttribute("data-room-code");
  // Discovery must arrive from the server, without sharing a URL, storage, or host state.
  await expect(
    guest.getByRole("button", {
      name: "Join Browser network verification",
      exact: true,
    }),
  ).toBeVisible();
  await guest
    .getByRole("button", {
      name: "Join Browser network verification",
      exact: true,
    })
    .click();
  await expect(guest.locator("[data-room-code]")).toHaveAttribute(
    "data-room-code",
    code!,
  );
  const hostId = await host
    .locator("[data-player-id]")
    .getAttribute("data-player-id");
  const guestId = await guest
    .locator("[data-player-id]")
    .getAttribute("data-player-id");
  expect(hostId).not.toBe(guestId);
  expect(await first.storageState()).not.toEqual(await second.storageState());
  await expect(host.getByText("Jordan Guest", { exact: true })).toBeVisible();
  await guest.reload();
  await expect(guest.locator("[data-room-code]")).toHaveAttribute(
    "data-room-code",
    code!,
    { timeout: 30_000 },
  );
  await expect(guest.locator("[data-player-id]")).toHaveAttribute(
    "data-player-id",
    guestId!,
  );
  await expect(
    host.getByRole("button", { name: "Start race", exact: true }),
  ).toBeDisabled();
  await host.getByRole("button", { name: "Ready up", exact: true }).click();
  await guest.getByRole("button", { name: "Ready up", exact: true }).click();
  await host.getByRole("button", { name: "Start race", exact: true }).click();
  await expect(host.locator("[data-race-state]")).toHaveAttribute(
    "data-race-state",
    /countdown|racing/,
  );
  await expect(guest.locator("[data-race-state]")).toHaveAttribute(
    "data-race-state",
    /countdown|racing/,
  );
  expect(
    await host.locator("[data-start-tick]").getAttribute("data-start-tick"),
  ).toBe(
    await guest.locator("[data-start-tick]").getAttribute("data-start-tick"),
  );
  await expect(host.locator("[data-race-state]")).toHaveAttribute(
    "data-race-state",
    "racing",
  );
  await expect(guest.locator("[data-race-state]")).toHaveAttribute(
    "data-race-state",
    "racing",
  );
  await host.locator("canvas").click({ position: { x: 450, y: 350 } });
  await host.keyboard.down("w");
  await expect
    .poll(
      () =>
        guestSnapshots.at(-1)?.cars.find((car) => car.id === hostId)?.speed ||
        0,
    )
    .toBeGreaterThan(5);
  await host.keyboard.up("w");
  await expect
    .poll(() =>
      hostSnapshots
        .at(-1)
        ?.cars.some(
          (car) =>
            car.id !== hostId && car.id !== guestId && Math.abs(car.speed) > 5,
        ),
    )
    .toBe(true);
  const token = await guest.evaluate(() =>
    sessionStorage.getItem("apex-reconnect"),
  );
  await second.setOffline(true);
  await expect(guest.locator(".connection-banner")).toContainText(
    "Reconnecting to the race...",
  );
  await second.setOffline(false);
  await expect(guest.locator("[data-race-state]")).toHaveAttribute(
    "data-race-state",
    "racing",
  );
  await expect(guest.locator("[data-player-id]")).toHaveAttribute(
    "data-player-id",
    guestId!,
  );
  await expect
    .poll(() => guest.evaluate(() => sessionStorage.getItem("apex-reconnect")))
    .not.toBe(token);
  await guest.screenshot({ path: "test-results/apex-race.png" });
  expect(errors).toEqual([]);
  host.on("dialog", (dialog) => dialog.accept());
  guest.on("dialog", (dialog) => dialog.accept());
  await host.getByRole("button", { name: "Leave race", exact: true }).click();
  await guest.getByRole("button", { name: "Leave race", exact: true }).click();
  await expect(guest.locator("[data-race-state]")).toHaveCount(0);
  await first.close();
  await second.close();
});

test("landing, circuit discovery, filtering, code errors, and mobile layout", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "FIND YOUR NEXT GEAR." }),
  ).toBeVisible();
  await expect(page.locator(".server-status")).toContainText("SERVERS ONLINE");
  await expect(page.locator(".hero-art canvas")).toBeVisible();
  await page.screenshot({
    path: "test-results/apex-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Explore rooms" }).click();
  await page.getByLabel("Filter by track").selectOption("harbor");
  await expect(
    page.getByRole("button", { name: "Join Harbor night shift" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Join Canyon after hours" }),
  ).toHaveCount(0);
  await page.getByLabel("Search rooms").fill("no matching grids");
  await expect(page.getByText("No rooms match your filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Join with code" }).click();
  await page.getByLabel("Room code or invite link").fill("ZZZZZZ");
  await page.getByRole("button", { name: "Join the grid" }).click();
  await expect(page.getByRole("alert")).toContainText("Room not found");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Explore circuits", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "TWO CIRCUITS. NO LIMITS." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await mobile.newPage();
  await phone.goto("/");
  await expect(
    phone.getByRole("heading", { name: "FIND YOUR NEXT GEAR." }),
  ).toBeVisible();
  expect(
    await phone.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await phone.screenshot({
    path: "test-results/apex-mobile.png",
    fullPage: true,
  });
  await phone.getByRole("button", { name: "Open navigation" }).click();
  await phone
    .getByRole("button", { name: "Explore circuits", exact: true })
    .click();
  await expect(
    phone.getByRole("heading", { name: "TWO CIRCUITS. NO LIMITS." }),
  ).toBeVisible();
  await mobile.close();
});

test("a solo driver can complete a real bot race on Neon Harbor and rematch from official results", async ({
  page,
}) => {
  test.setTimeout(130_000);
  const received = snapshots(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".server-status")).toContainText("SERVERS ONLINE");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await page.getByLabel("Room name").fill("Solo harbor shakedown");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Neon Harbor/ })
    .click();
  await page.getByLabel("Laps", { exact: true }).selectOption("1");
  await page.getByLabel("Grid size", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Create public room" }).click();
  await expect(page.locator("[data-room-code]")).toBeVisible();
  const id = await page
    .locator("[data-player-id]")
    .getAttribute("data-player-id");
  await page.getByRole("button", { name: "Ready up", exact: true }).click();
  await page.getByRole("button", { name: "Start race", exact: true }).click();
  await expect(page.locator("[data-race-state]")).toHaveAttribute(
    "data-race-state",
    "racing",
  );
  await page.screenshot({ path: "test-results/apex-harbor.png" });
  // The human deliberately stays on the grid. A real bot must earn its lap,
  // then race control's normal first-finisher timeout produces official DNF standings.
  await expect
    .poll(() => received.at(-1)?.state, { timeout: 110_000 })
    .toBe("finished");
  await expect(
    page.getByRole("heading", { name: "THAT'S A WRAP." }),
  ).toBeVisible();
  const results = received.at(-1)!.results;
  expect(results.find((result) => result.id !== id)).toMatchObject({
    position: 1,
    dnf: false,
  });
  expect(
    results.find((result) => result.id !== id)!.bestLapTicks,
  ).toBeGreaterThan(0);
  expect(results.find((result) => result.id === id)?.dnf).toBe(true);
  await page.screenshot({ path: "test-results/apex-results.png" });
  await page.getByRole("button", { name: "Run it back" }).click();
  await expect(page.locator("[data-room-code]")).toBeVisible();
  await expect(page.getByLabel("Lobby track")).toHaveValue("harbor");
  await expect(
    page.getByRole("button", { name: "Start race", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "BACK TO PADDOCK", exact: true })
    .click();
  expect(errors).toEqual([]);
});
