import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.COURT_PLUGIN_TEST_URL ?? "http://127.0.0.1:5173";
const evidenceDirectory = new URL("../../docs/evidence/", import.meta.url);
const evidenceOutputDirectory =
  process.env.COURT_PLUGIN_EVIDENCE_DIR ?? evidenceDirectory;
await mkdir(evidenceOutputDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/snap/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto(`${baseUrl}/test/browser/mock-pexip.html`, {
    waitUntil: "networkidle",
  });
  const startControl = page.getByTestId("hearing-start");
  const returnControl = page.getByTestId("hearing-return");
  await startControl.waitFor();
  await returnControl.waitFor();
  await screenshot(page, "01-idle-two-cases-waiting.png");

  await startControl.click();
  await page.getByTestId("room-form").waitFor();
  const options = await page
    .getByTestId("room-select")
    .locator("option")
    .allTextContents();
  if (
    options.length !== 3 ||
    options[0] !== "Case 2026-0412 (2)" ||
    options[1] !== "Case 2026-0413 (2)" ||
    options.at(-1) !== "Admit all waiting rooms at once" ||
    options.some((option) => option.includes("Observer only"))
  ) {
    throw new Error(`Unexpected final room option: ${JSON.stringify(options)}`);
  }
  await page.getByTestId("form-close").click();
  await page.waitForTimeout(100);
  if (await page.getByTestId("toast").isVisible()) {
    throw new Error("Closing the room selector unexpectedly showed a toast");
  }

  await startControl.click();
  await page.getByTestId("room-form").waitFor();
  await screenshot(page, "02-room-selection-case-a.png");

  await page
    .getByTestId("room-form")
    .getByRole("button", { name: "Start hearing" })
    .click();
  await expectTitle(page, "hearing-start", "Updating the hearing");
  await page.waitForTimeout(2000);
  if (!(await returnControl.isDisabled())) {
    throw new Error("Pause was enabled before the start countdown completed");
  }
  await expectTitle(page, "hearing-return", "Updating the hearing");
  await screenshot(page, "03-starting-case-a-guarded.png");
  await expectTitle(page, "hearing-start", "Start a case hearing");
  if (await returnControl.isDisabled()) {
    throw new Error(
      "Pause remained disabled after the start countdown completed",
    );
  }
  await page.getByTestId("toast").waitFor();
  await screenshot(page, "04-case-a-active-success.png");

  await startControl.click();
  await page.getByTestId("room-form").waitFor();
  const optionsAfterStart = await page
    .getByTestId("room-select")
    .locator("option")
    .allTextContents();
  if (
    optionsAfterStart.length !== 2 ||
    optionsAfterStart[0] !== "Case 2026-0413 (2)" ||
    optionsAfterStart[1] !== "Admit all waiting rooms at once"
  ) {
    throw new Error(
      `Moved participants remained in the room count: ${JSON.stringify(optionsAfterStart)}`,
    );
  }
  await page.getByTestId("form-close").click();

  await returnControl.click();
  await expectTitle(page, "hearing-return", "Updating the hearing");
  await screenshot(page, "05-pausing-case-a-guarded.png");
  await expectTitle(page, "hearing-return", "Pause hearing");
  await page.getByTestId("toast").waitFor();
  await screenshot(page, "06-case-a-returned.png");

  await startControl.click();
  await page.getByTestId("room-select").selectOption("breakout-case-b");
  await screenshot(page, "07-room-selection-case-b.png");
  await page
    .getByTestId("room-form")
    .getByRole("button", { name: "Start hearing" })
    .click();
  await expectTitle(page, "hearing-start", "Updating the hearing");
  await expectTitle(page, "hearing-start", "Start a case hearing");
  await page.getByTestId("toast").waitFor();
  await screenshot(page, "08-case-b-active-case-a-waiting.png");

  await page.evaluate(() => window.mockPexip.failNextMove());
  await returnControl.click();
  await expectTitle(page, "hearing-return", "Updating the hearing");
  await expectTitle(page, "hearing-return", "Pause hearing");
  await page
    .getByTestId("toast")
    .filter({ hasText: "could not be fully updated" })
    .waitFor();
  await screenshot(page, "09-return-failure-active-state-retained.png");

  const snapshot = await page.evaluate(() => window.mockPexip.snapshot());
  const moveRequests = await page.evaluate(() =>
    window.mockPexip.moveRequests(),
  );
  const applicationMessages = await page.evaluate(() =>
    window.mockPexip.applicationMessages(),
  );
  if (
    snapshot.main.join(",") !==
      "clerk-chair,court-chair,case-b-bob,case-b-interpreter" ||
    snapshot["breakout-case-a"].join(",") !==
      "mmm-observer-a,case-a-alice,case-a-counsel" ||
    snapshot["breakout-case-b"].join(",") !== "mmm-observer-b" ||
    snapshot["breakout-observer-only"].join(",") !== "mmm-observer-only"
  ) {
    throw new Error(
      `Unexpected final room membership: ${JSON.stringify(snapshot)}`,
    );
  }
  const expectedReturns = [moveRequests[1], moveRequests[3]];
  const expectedStarts = [moveRequests[0], moveRequests[2]];
  if (
    moveRequests.length !== 4 ||
    expectedStarts.some(
      (request) =>
        request?.participants?.length !== 0 ||
        request.participants.some((id) => id.endsWith("-control")),
    ) ||
    expectedReturns.some(
      (request) =>
        request?.toRoomUuid !== "previous" ||
        request?.participants?.length !== 0 ||
        "fromBreakoutUuid" in request,
    )
  ) {
    throw new Error(
      `Unexpected native return payloads: ${JSON.stringify(moveRequests)}`,
    );
  }
  if (
    applicationMessages.length !== 2 ||
    applicationMessages.some(
      ({ payload }) =>
        payload?.pluginId !== "pause-resume-hearing-plugin" ||
        payload?.protocolVersion !== 1 ||
        payload?.type !== "hearing-countdown-started" ||
        typeof payload?.operationId !== "string" ||
        payload?.seconds !== 10,
    )
  ) {
    throw new Error(
      `Unexpected countdown broadcasts: ${JSON.stringify(applicationMessages)}`,
    );
  }

  const remoteCountdown = {
    pluginId: "pause-resume-hearing-plugin",
    protocolVersion: 1,
    type: "hearing-countdown-started",
    operationId: "remote-countdown",
    seconds: 10,
  };
  await page.evaluate(
    (message) =>
      window.mockPexip.emitApplicationMessage({
        id: "chair-countdown-message",
        userId: "court-chair",
        message,
      }),
    remoteCountdown,
  );
  await page
    .getByTestId("toast")
    .filter({ hasText: "Hearing starts in 10 second(s)" })
    .waitFor();
  await page.evaluate(() =>
    window.mockPexip.emitApplicationMessage({
      id: "chair-countdown-cancel-message",
      userId: "court-chair",
      message: {
        pluginId: "pause-resume-hearing-plugin",
        protocolVersion: 1,
        type: "hearing-countdown-cancelled",
        operationId: "remote-countdown",
      },
    }),
  );
  await page.getByTestId("toast").waitFor({ state: "hidden" });
  if (pageErrors.length > 0) throw pageErrors[0];
} finally {
  await browser.close();
}

async function expectTitle(page, testId, text) {
  await page.waitForFunction(
    ({ expected, target }) =>
      document
        .querySelector(`[data-testid="${target}"]`)
        ?.title.includes(expected),
    { expected: text, target: testId },
  );
}

async function screenshot(page, name) {
  await page.screenshot({
    path:
      typeof evidenceOutputDirectory === "string"
        ? resolve(evidenceOutputDirectory, name)
        : new URL(name, evidenceOutputDirectory).pathname,
    fullPage: true,
  });
}
