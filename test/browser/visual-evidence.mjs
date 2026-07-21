import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.COURT_PLUGIN_TEST_URL ?? "http://127.0.0.1:5173";
const evidenceDirectory = new URL("../../docs/evidence/", import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });

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
  await screenshot(page, "02-room-selection-case-a.png");

  await page.getByTestId("room-form").getByRole("button").click();
  await expectTitle(page, "hearing-start", "Updating the hearing");
  await screenshot(page, "03-starting-case-a-guarded.png");
  await expectTitle(page, "hearing-start", "Start a case hearing");
  await page.getByTestId("toast").waitFor();
  await screenshot(page, "04-case-a-active-success.png");

  await returnControl.click();
  await expectTitle(page, "hearing-return", "Updating the hearing");
  await screenshot(page, "05-pausing-case-a-guarded.png");
  await expectTitle(page, "hearing-return", "Pause hearing");
  await page.getByTestId("toast").waitFor();
  await screenshot(page, "06-case-a-returned.png");

  await startControl.click();
  await page.getByTestId("room-select").selectOption("breakout-case-b");
  await screenshot(page, "07-room-selection-case-b.png");
  await page.getByTestId("room-form").getByRole("button").click();
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
    .filter({ hasText: "could not be updated" })
    .waitFor();
  await screenshot(page, "09-return-failure-active-state-retained.png");

  const snapshot = await page.evaluate(() => window.mockPexip.snapshot());
  const moveRequests = await page.evaluate(() =>
    window.mockPexip.moveRequests(),
  );
  if (
    snapshot.main.join(",") !==
      "clerk-chair,court-chair,case-b-bob,case-b-interpreter" ||
    snapshot["breakout-case-a"].join(",") !== "case-a-alice,case-a-counsel" ||
    snapshot["breakout-case-b"].length !== 0
  ) {
    throw new Error(
      `Unexpected final room membership: ${JSON.stringify(snapshot)}`,
    );
  }
  const expectedReturns = [moveRequests[1], moveRequests[3]];
  if (
    moveRequests.length !== 4 ||
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
    path: new URL(name, evidenceDirectory).pathname,
    fullPage: true,
  });
}
