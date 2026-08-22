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
    options[0] !== "Admit all waiting rooms at once" ||
    options[1] !== "Case 2026-0412 (2)" ||
    options[2] !== "Case 2026-0413 (2)" ||
    options.some((option) => option.includes("Observer only"))
  ) {
    throw new Error(`Unexpected room options: ${JSON.stringify(options)}`);
  }
  if (
    (await page.getByTestId("room-select").inputValue()) !==
    "__all_waiting_rooms__"
  ) {
    throw new Error("Admit all waiting rooms was not selected by default");
  }
  await page.getByTestId("form-close").click();
  await page.waitForTimeout(100);
  if (await page.getByTestId("toast").isVisible()) {
    throw new Error("Closing the room selector unexpectedly showed a toast");
  }

  await startControl.click();
  await page.getByTestId("room-form").waitFor();
  await page.getByTestId("room-select").selectOption("breakout-case-a");
  await screenshot(page, "02-room-selection-case-a.png");

  await page
    .getByTestId("room-form")
    .getByRole("button", { name: "Start hearing" })
    .click();
  await expectTitle(page, "hearing-start", "Updating the hearing");
  await page.waitForFunction(
    () => window.mockPexip.moveRequests().length === 1,
  );
  await page
    .getByTestId("toast")
    .filter({ hasText: "admitted from Case 2026-0412" })
    .waitFor();
  if (!(await returnControl.isDisabled())) {
    throw new Error("Pause was enabled before the start hold completed");
  }
  await expectTitle(page, "hearing-return", "Updating the hearing");
  await screenshot(page, "03-starting-case-a-guarded.png");
  await expectTitle(page, "hearing-start", "Start a case hearing");
  if (await returnControl.isDisabled()) {
    throw new Error("Pause remained disabled after the start hold completed");
  }
  await screenshot(page, "04-case-a-active-success.png");

  await startControl.click();
  await page.getByTestId("room-form").waitFor();
  const optionsAfterStart = await page
    .getByTestId("room-select")
    .locator("option")
    .allTextContents();
  if (
    optionsAfterStart.length !== 2 ||
    optionsAfterStart[0] !== "Admit all waiting rooms at once" ||
    optionsAfterStart[1] !== "Case 2026-0413 (2)"
  ) {
    throw new Error(
      `Moved participants remained in the room count: ${JSON.stringify(optionsAfterStart)}`,
    );
  }
  await page.getByTestId("form-close").click();

  await returnControl.click();
  await expectTitle(page, "hearing-return", "Updating the hearing");
  await page.waitForFunction(
    () => window.mockPexip.moveRequests().length === 2,
  );
  await page
    .getByTestId("toast")
    .filter({ hasText: "returned to their previous rooms" })
    .waitFor();
  if (!(await startControl.isDisabled())) {
    throw new Error("Start was enabled before the pause hold completed");
  }
  await expectTitle(page, "hearing-start", "Updating the hearing");
  await screenshot(page, "05-pausing-case-a-guarded.png");
  await expectTitle(page, "hearing-return", "Pause hearing");
  if (await startControl.isDisabled()) {
    throw new Error("Start remained disabled after the pause hold completed");
  }
  await screenshot(page, "06-case-a-returned.png");

  await startControl.click();
  await page.getByTestId("room-select").selectOption("breakout-case-b");
  await screenshot(page, "07-room-selection-case-b.png");
  await page
    .getByTestId("room-form")
    .getByRole("button", { name: "Start hearing" })
    .click();
  await expectTitle(page, "hearing-start", "Updating the hearing");
  await page.waitForFunction(
    () => window.mockPexip.moveRequests().length === 3,
  );
  await page
    .getByTestId("toast")
    .filter({ hasText: "admitted from Case 2026-0413" })
    .waitFor();
  if (!(await returnControl.isDisabled())) {
    throw new Error("Pause was enabled before the second Start hold completed");
  }
  await screenshot(page, "08-case-b-active-case-a-waiting.png");
  await expectTitle(page, "hearing-start", "Start a case hearing");

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
      "pexip-observer-a,case-a-alice,case-a-counsel" ||
    snapshot["breakout-case-b"].join(",") !== "pexip-observer-b" ||
    snapshot["breakout-observer-only"].join(",") !== "pexip-observer-only"
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
  const applicationPayloads = applicationMessages.map(({ payload }) => payload);
  const countdownBroadcasts = applicationPayloads.filter(
    ({ type }) => type === "hearing-countdown-started",
  );
  const startedBroadcasts = applicationPayloads.filter(
    ({ type }) => type === "hearing-started",
  );
  const pausedBroadcasts = applicationPayloads.filter(
    ({ type }) => type === "hearing-paused",
  );
  const cancelledBroadcasts = applicationPayloads.filter(
    ({ type }) => type === "hearing-countdown-cancelled",
  );
  if (
    applicationMessages.length !== 8 ||
    applicationPayloads.some(
      (payload) =>
        payload?.pluginId !== "pause-resume-hearing-plugin" ||
        payload?.protocolVersion !== 1 ||
        typeof payload?.operationId !== "string",
    ) ||
    countdownBroadcasts.length !== 4 ||
    countdownBroadcasts.some(
      ({ seconds, action }) =>
        seconds !== 10 || (action !== "start" && action !== "pause"),
    ) ||
    countdownBroadcasts.filter(({ action }) => action === "start").length !==
      2 ||
    countdownBroadcasts.filter(({ action }) => action === "pause").length !==
      2 ||
    startedBroadcasts.length !== 2 ||
    startedBroadcasts.some(
      ({ allRooms, participantCount, roomName }) =>
        allRooms !== false ||
        participantCount !== 2 ||
        typeof roomName !== "string" ||
        !roomName.startsWith("Case 2026-"),
    ) ||
    pausedBroadcasts.length !== 1 ||
    cancelledBroadcasts.length !== 1
  ) {
    throw new Error(
      `Unexpected hearing broadcasts: ${JSON.stringify(applicationMessages)}`,
    );
  }

  const remoteCountdown = {
    pluginId: "pause-resume-hearing-plugin",
    protocolVersion: 1,
    type: "hearing-countdown-started",
    operationId: "remote-countdown",
    seconds: 10,
    action: "start",
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
  await expectTitle(page, "hearing-start", "Updating the hearing");
  if (!(await returnControl.isDisabled())) {
    throw new Error("Pause was enabled during another host's action hold");
  }
  await page.evaluate(() =>
    window.mockPexip.emitApplicationMessage({
      id: "chair-countdown-success-message",
      userId: "court-chair",
      message: {
        pluginId: "pause-resume-hearing-plugin",
        protocolVersion: 1,
        type: "hearing-started",
        operationId: "remote-countdown",
        allRooms: false,
        participantCount: 3,
        roomName: "Remote case",
      },
    }),
  );
  await page
    .getByTestId("toast")
    .filter({ hasText: "3 participant(s) admitted from Remote case." })
    .waitFor();
  if (!(await returnControl.isDisabled())) {
    throw new Error("Another host's success ended the action hold early");
  }
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
  await expectTitle(page, "hearing-start", "Start a case hearing");

  const remotePauseCountdown = {
    ...remoteCountdown,
    operationId: "remote-pause-countdown",
    action: "pause",
  };
  await page.evaluate(
    (message) =>
      window.mockPexip.emitApplicationMessage({
        id: "chair-pause-countdown-message",
        userId: "court-chair",
        message,
      }),
    remotePauseCountdown,
  );
  await expectTitle(page, "hearing-return", "Updating the hearing");
  if (!(await startControl.isDisabled())) {
    throw new Error("Start was enabled during another host's Pause hold");
  }
  await page.evaluate(() =>
    window.mockPexip.emitApplicationMessage({
      id: "chair-pause-countdown-success-message",
      userId: "court-chair",
      message: {
        pluginId: "pause-resume-hearing-plugin",
        protocolVersion: 1,
        type: "hearing-paused",
        operationId: "remote-pause-countdown",
      },
    }),
  );
  await page
    .getByTestId("toast")
    .filter({
      hasText: "Participants were returned to their previous rooms.",
    })
    .waitFor();
  if (!(await startControl.isDisabled())) {
    throw new Error("Another host's Pause success ended the hold early");
  }
  await page.evaluate(() =>
    window.mockPexip.emitApplicationMessage({
      id: "chair-pause-countdown-cancel-message",
      userId: "court-chair",
      message: {
        pluginId: "pause-resume-hearing-plugin",
        protocolVersion: 1,
        type: "hearing-countdown-cancelled",
        operationId: "remote-pause-countdown",
      },
    }),
  );
  await expectTitle(page, "hearing-return", "Pause hearing");

  await page.evaluate(() =>
    window.mockPexip.emitApplicationMessage({
      id: "chair-started-message",
      userId: "court-chair",
      message: {
        pluginId: "pause-resume-hearing-plugin",
        protocolVersion: 1,
        type: "hearing-started",
        operationId: "remote-start",
        allRooms: false,
        participantCount: 3,
        roomName: "Remote case",
      },
    }),
  );
  await page
    .getByTestId("toast")
    .filter({ hasText: "3 participant(s) admitted from Remote case." })
    .waitFor();
  await page.evaluate(() =>
    window.mockPexip.emitApplicationMessage({
      id: "chair-paused-message",
      userId: "court-chair",
      message: {
        pluginId: "pause-resume-hearing-plugin",
        protocolVersion: 1,
        type: "hearing-paused",
        operationId: "remote-pause",
      },
    }),
  );
  await page
    .getByTestId("toast")
    .filter({
      hasText: "Participants were returned to their previous rooms.",
    })
    .waitFor();
  const toastMessages = await page.evaluate(() =>
    window.mockPexip.toastMessages(),
  );
  if (
    toastMessages.some(
      (message) =>
        message.includes("Hearing starts in") ||
        message.includes("Participants return in"),
    )
  ) {
    throw new Error(
      `A countdown toast was shown: ${JSON.stringify(toastMessages)}`,
    );
  }
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
