import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { chromium, request as playwrightRequest } from "playwright-core";

const mmmEnvPath = new URL(
  "../../../MultiMeetingManager.project/local-git/MultiMeetingManager/env.kinly.dev",
  import.meta.url,
);
const evidenceDirectory = new URL("../../docs/evidence/", import.meta.url);
const pluginHtml = await readFile(
  new URL("../../dist/index.html", import.meta.url),
);
const pluginScript = await readFile(
  new URL("../../dist/assets/index.js", import.meta.url),
);
const pluginConfiguration = await readFile(
  new URL("../../dist/assets/configuration.json", import.meta.url),
);
process.loadEnvFile(mmmEnvPath);

const localBaseUrl = "https://localhost:3001";
const controllerName = `Court plugin controller ${randomUUID().slice(0, 8)}`;
const caseDefinitions = [
  {
    name: `Court Plugin Live Case A ${randomUUID().slice(0, 6)}`,
    participants: ["Live A participant", "Live A counsel"],
  },
  {
    name: `Court Plugin Live Case B ${randomUUID().slice(0, 6)}`,
    participants: ["Live B participant", "Live B interpreter"],
  },
];

const sessions = [];
const breakoutIds = [];
let controller;
let conference;
let browser;
let page;
let rosterTracker;
let liveStage = "initializing";
const breakoutRequests = [];

try {
  const api = await playwrightRequest.newContext({
    baseURL: localBaseUrl,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: localBaseUrl },
  });
  const login = await api.post("/auth/local-login", {
    data: {
      username: process.env.LOCAL_LOGIN_USERNAME,
      password: process.env.LOCAL_LOGIN_PASSWORD,
    },
  });
  assertStatus(login.status(), 200, "local login");
  const selection = await api.put("/api/access-groups/selection", {
    data: {
      allNamedAccessGroups: true,
      includeUnassigned: true,
      selectedAccessGroupIds: [],
    },
  });
  assertStatus(selection.status(), 200, "access-group selection");
  const snapshotResponse = await api.get("/api/state-snapshot");
  assertStatus(snapshotResponse.status(), 200, "state snapshot");
  const snapshot = await snapshotResponse.json();
  const target = selectTarget(snapshot);

  const meetingManagerJoin = await requestJoinUrl(
    api,
    target,
    "meeting-manager",
  );
  const controlJoin = await requestJoinUrl(api, target, "control-only");
  const parsedMeetingManager = parseJoinUrl(meetingManagerJoin.url);
  conference = {
    host: parsedMeetingManager.host,
    alias: parsedMeetingManager.alias,
    pin: parsedMeetingManager.pin,
  };
  if (!conference.pin)
    throw new Error("Meeting-manager join did not provide a PIN");

  controller = await createSession(conference, controllerName);
  sessions.push(controller);
  rosterTracker = await startRosterTracker(conference, controller.token);
  for (const definition of caseDefinitions) {
    const breakout = await pexipJson(conference, "/breakouts", {
      method: "POST",
      token: controller.token,
      body: {
        name: definition.name,
        description: "Automated room-scoped hearing validation",
        end_action: "transfer",
      },
    });
    const breakoutId = breakout.result.breakout_uuid;
    breakoutIds.push(breakoutId);
  }

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/snap/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });

  const mainParticipantIds = [];
  for (const definition of caseDefinitions) {
    const ids = [];
    for (const displayName of definition.participants) {
      ids.push(
        await joinMainWithWebapp({
          browser,
          conference,
          displayName,
          rosterTracker,
        }),
      );
    }
    mainParticipantIds.push(ids);
  }
  const caseParticipantIds = [];
  for (const [caseIndex, ids] of mainParticipantIds.entries()) {
    const roomBefore = rosterTracker.getMovable(breakoutIds[caseIndex]);
    await pexipJson(conference, "/participants/breakout", {
      method: "POST",
      token: controller.token,
      body: {
        breakout_uuid: breakoutIds[caseIndex],
        participants: ids,
      },
    });
    caseParticipantIds.push(
      await waitForTransferredParticipants(rosterTracker, {
        previousIds: ids,
        destinationRoomId: breakoutIds[caseIndex],
        destinationBefore: roomBefore,
      }),
    );
  }
  const [caseAIds, caseBIds] = caseParticipantIds;
  await waitForMembership(rosterTracker, {
    present: {
      [breakoutIds[0]]: caseAIds,
      [breakoutIds[1]]: caseBIds,
    },
    absent: { main: [...caseAIds, ...caseBIds] },
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: true,
    permissions: ["camera", "microphone"],
  });
  await context.addInitScript(() => {
    window.__courtPluginMessages = [];
    window.addEventListener("message", (event) => {
      const value = event.data;
      if (value?.rpc || value?.event || value?.replyTo) {
        window.__courtPluginMessages.push({
          at: Date.now(),
          chanId: value.chanId,
          id: value.id,
          rpc: value.rpc,
          event: value.event,
          replyTo: value.replyTo,
          payload: value.payload,
        });
      }
    });
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!isCourtPluginUrl(url.href)) {
      await route.continue();
      return;
    }
    if (url.pathname.endsWith(".js")) {
      await route.fulfill({
        status: 200,
        contentType: "text/javascript; charset=utf-8",
        body: pluginScript,
      });
      return;
    }
    if (url.pathname.endsWith("/assets/configuration.json")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: pluginConfiguration,
      });
      return;
    }
    if (request.resourceType() === "document") {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        headers: {
          "content-security-policy":
            "default-src 'self'; script-src 'self'; frame-ancestors https://courts.kinly.dev",
        },
        body: pluginHtml,
      });
      return;
    }
    await route.continue();
  });

  page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("request", (request) => {
    if (!request.url().includes("/participants/breakout")) return;
    let body;
    try {
      body = request.postDataJSON();
    } catch {
      body = undefined;
    }
    breakoutRequests.push({
      method: request.method(),
      pathHash: hash(new URL(request.url()).pathname),
      target: body?.breakout_uuid,
      participantHashes: Array.isArray(body?.participants)
        ? body.participants.map(hash)
        : [],
    });
  });
  page.on("response", (response) => {
    if (!response.url().includes("/participants/breakout")) return;
    breakoutRequests.push({
      responseStatus: response.status(),
      pathHash: hash(new URL(response.url()).pathname),
    });
  });
  liveStage = "loading Webapp3";
  await page.goto(controlJoin.url, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await advanceIntoMeeting(page, 90_000);
  liveStage = "waiting for plugin registration";
  await waitForPluginRpc(page, "ui:button:add", 90_000);
  liveStage = "waiting for plugin breakout roster";
  await waitForPluginRoster(page, {
    [breakoutIds[0]]: caseAIds,
    [breakoutIds[1]]: caseBIds,
  });
  liveStage = "waiting for toolbar control";
  await waitForControl(page, "Start a case hearing", 60_000);
  liveStage = "capturing idle state";
  await revealMeetingControls(page);
  await page.screenshot({
    path: new URL("10-live-pexip-idle.png", evidenceDirectory).pathname,
    fullPage: true,
  });

  await clickControl(page, "Start a case hearing");
  liveStage = "opening room selection";
  await waitForPluginRpc(page, "ui:form:open", 30_000);
  const select = page.locator("select").last();
  await select.waitFor({ state: "visible", timeout: 30_000 });
  await select.selectOption(breakoutIds[0]);
  liveStage = "capturing room selection";
  await page.waitForTimeout(600);
  await page.screenshot({
    path: new URL("11-live-pexip-room-selection.png", evidenceDirectory)
      .pathname,
    fullPage: true,
  });
  const mainBeforeStart = rosterTracker.getMovable("main");
  const selectedRoomApiParticipants = rosterTracker.getApi(breakoutIds[0]);
  if (selectedRoomApiParticipants.size === 0) {
    throw new Error("Selected breakout has no API observer leg to validate");
  }
  await page
    .getByRole("button", { name: "Start hearing", exact: true })
    .click();
  liveStage = "moving selected room to main";
  await waitForPluginMove(page, {
    fromBreakoutUuid: breakoutIds[0],
    toRoomUuid: "main",
    participants: [],
  });
  await waitForTransferredParticipants(rosterTracker, {
    previousIds: caseAIds,
    destinationRoomId: "main",
    destinationBefore: mainBeforeStart,
    unchanged: {
      [breakoutIds[0]]: [...selectedRoomApiParticipants],
      [breakoutIds[1]]: caseBIds,
    },
  });
  liveStage = "capturing active hearing";
  await revealMeetingControls(page);
  await page.screenshot({
    path: new URL("12-live-pexip-case-a-active.png", evidenceDirectory)
      .pathname,
    fullPage: true,
  });

  await clickControl(page, "Pause hearing");
  liveStage = "returning selected room";
  await waitForPluginMove(page, {
    toRoomUuid: "previous",
    participants: [],
  });
  await waitForMembership(rosterTracker, {
    present: { [breakoutIds[1]]: caseBIds },
  });
  assertTwoAcceptedPluginMoves(breakoutRequests);
  liveStage = "capturing returned state";
  await revealMeetingControls(page);
  await page.screenshot({
    path: new URL("13-live-pexip-case-a-returned.png", evidenceDirectory)
      .pathname,
    fullPage: true,
  });

  if (pageErrors.length > 0) throw pageErrors[0];
  const report = {
    generatedAt: new Date().toISOString(),
    livePexipValidated: true,
    hearingHash: hash(target.hearing.id),
    breakoutHashes: breakoutIds.map(hash),
    selectedBreakoutParticipantCount: 2,
    retainedApiObserverCount: selectedRoomApiParticipants.size,
    waitingBreakoutParticipantCount: 2,
    nativePreviousReturnValidated: true,
    returnDestinationReconnectObserved: false,
    liveEnvironmentNote:
      "The headless Webapp3 clients did not reconnect after their third room transfer; Pexip accepted the native previous-room return request with HTTP 200.",
    assertions: {
      pluginRegisteredInWebapp3: true,
      roomSelectionRendered: true,
      selectedRoomOnlyMovedToMain: true,
      otherWaitingRoomUnchangedDuringStart: true,
      selectedParticipantReturnAcceptedByPexip: true,
      nativePreviousDestinationAccepted: true,
      otherWaitingRoomUnchangedDuringPause: true,
    },
    screenshots: [
      "10-live-pexip-idle.png",
      "11-live-pexip-room-selection.png",
      "12-live-pexip-case-a-active.png",
      "13-live-pexip-case-a-returned.png",
    ],
  };
  await writeFile(
    new URL("live-validation-report.json", evidenceDirectory),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(report));
  await api.dispose();
} catch (error) {
  if (page) {
    await page
      .screenshot({
        path: new URL("live-validation-diagnostic.png", evidenceDirectory)
          .pathname,
        fullPage: true,
      })
      .catch(() => undefined);
    const diagnostic = await collectWebappDiagnostics(page).catch(() => ({}));
    await writeFile(
      new URL("live-validation-diagnostic.json", evidenceDirectory),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          stage: liveStage,
          error: error instanceof Error ? error.message : String(error),
          breakoutRequests,
          ...diagnostic,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ).catch(() => undefined);
  }
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  await rosterTracker?.stop().catch(() => undefined);
  if (conference && controller) {
    for (const breakoutId of breakoutIds) {
      await pexipJson(
        conference,
        `/breakouts/${encodeURIComponent(breakoutId)}/disconnect`,
        {
          method: "POST",
          token: controller.token,
        },
      ).catch(() => undefined);
    }
  }
  if (conference) {
    for (const session of sessions.reverse()) {
      await pexipJson(conference, "/release_token", {
        method: "POST",
        token: session.token,
        alias: session.alias,
        body: {},
      }).catch(() => undefined);
    }
  }
}

async function requestJoinUrl(api, target, mode) {
  const joinTarget = target.joinTargets.find(
    (candidate) => candidate.mode === mode,
  );
  if (!joinTarget) throw new Error(`No ${mode} target is available`);
  const response = await api.post("/api/join-url", {
    data: {
      hearingId: target.hearing.id,
      roomId: target.room.id,
      joinTargetId: joinTarget.id,
      mode,
    },
  });
  assertStatus(response.status(), 200, `${mode} join URL`);
  return response.json();
}

function selectTarget(snapshot) {
  const candidates = snapshot.hearings
    .map((hearing) => ({
      hearing,
      room: snapshot.rooms.find(
        (room) => room.hearingId === hearing.id && room.kind === "main",
      ),
      joinTargets: (hearing.joinTargetIds ?? [])
        .map((id) => snapshot.joinTargets.find((target) => target.id === id))
        .filter(Boolean),
      breakoutCount: snapshot.rooms.filter(
        (room) => room.hearingId === hearing.id && room.kind === "breakout",
      ).length,
    }))
    .filter(
      ({ room, joinTargets }) =>
        room &&
        joinTargets.some(({ mode }) => mode === "meeting-manager") &&
        joinTargets.some(({ mode }) => mode === "control-only"),
    )
    .sort((left, right) => right.breakoutCount - left.breakoutCount);
  if (!candidates[0])
    throw new Error(
      "No live-validation hearing with required join modes exists",
    );
  return candidates[0];
}

function parseJoinUrl(value) {
  const url = new URL(value);
  const hashParameters = new URLSearchParams(
    url.hash.slice(url.hash.indexOf("?") + 1),
  );
  const path = url.pathname.split("/").filter(Boolean);
  const meetingIndex = path.lastIndexOf("m");
  const alias =
    (meetingIndex >= 0 ? path[meetingIndex + 1] : undefined) ??
    url.searchParams.get("conference") ??
    hashParameters.get("conference");
  if (!alias) throw new Error("Join URL did not contain a conference alias");
  return {
    host: url.origin,
    alias: decodeURIComponent(alias),
    pin: url.searchParams.get("pin") ?? hashParameters.get("pin"),
  };
}

async function createSession(conference, displayName) {
  const response = await pexipJson(conference, "/request_token", {
    method: "POST",
    headers: { pin: conference.pin },
    body: {
      display_name: displayName,
      direct_media: false,
      call_tag: `court-plugin-live-${randomUUID()}`,
      supports_direct_chat: false,
    },
  });
  if (!response.result?.token || !response.result?.participant_uuid) {
    throw new Error(
      "Pexip session creation returned no token or participant UUID",
    );
  }
  return {
    token: response.result.token,
    participantId: response.result.participant_uuid,
    alias: conference.alias,
  };
}

async function joinMainWithWebapp({
  browser,
  conference,
  displayName,
  rosterTracker,
}) {
  const membershipBeforeJoin = rosterTracker.getMovable("main");
  const template = process.env.JOIN_URL_AUDIO_VIDEO_TEMPLATE;
  const webappBaseUrl = process.env.WEBAPP3_BASE_URL;
  if (!template || !webappBaseUrl) {
    throw new Error("Main-room Webapp3 join configuration is unavailable");
  }
  for (const placeholder of ["{alias}", "{pin}", "{name}"]) {
    if (!template.includes(placeholder)) {
      throw new Error(`Main-room join template is missing ${placeholder}`);
    }
  }
  const joinUrl = new URL(
    template
      .replaceAll("{alias}", encodeURIComponent(conference.alias))
      .replaceAll("{pin}", encodeURIComponent(conference.pin))
      .replaceAll("{name}", encodeURIComponent(displayName)),
    webappBaseUrl,
  ).href;
  const context = await browser.newContext({
    viewport: { width: 960, height: 720 },
    ignoreHTTPSErrors: true,
    permissions: ["camera", "microphone"],
  });
  const page = await context.newPage();
  await page.goto(joinUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const participantId = rosterTracker.findNewMovableParticipant(
      "main",
      membershipBeforeJoin,
    );
    if (participantId) return participantId;
    await clickJoinControls(page);
    await page.waitForTimeout(750);
  }
  throw new Error("Main-room participant did not join through Webapp3");
}

async function pexipJson(conference, suffix, options = {}) {
  const alias = options.alias ?? conference.alias;
  const response = await fetch(
    `${conference.host}/api/client/v2/conferences/${encodeURIComponent(alias)}${suffix}`,
    {
      method: options.method ?? "GET",
      headers: {
        ...(options.token ? { token: options.token } : {}),
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...options.headers,
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok || body.status !== "success") {
    throw new Error(`Pexip request failed with HTTP ${response.status}`);
  }
  return body;
}

async function startRosterTracker(conference, token) {
  const abort = new AbortController();
  const rooms = new Map([["main", new Set()]]);
  const pending = new Map();
  const displayNames = new Map();
  const protocols = new Map();
  const serviceTypes = new Map();
  const waitingStates = new Map();
  let failure;
  const response = await fetch(
    `${conference.host}/api/client/v2/conferences/${encodeURIComponent(conference.alias)}/events?token=${encodeURIComponent(token)}`,
    { signal: abort.signal },
  );
  if (!response.ok || !response.body) {
    throw new Error(`Pexip SSE returned HTTP ${response.status}`);
  }
  const task = consumeRosterEvents(response.body, {
    onEvent(event, data) {
      if (event === "breakout_begin") {
        rooms.set(
          data.breakout_uuid,
          rooms.get(data.breakout_uuid) ?? new Set(),
        );
        return;
      }
      if (event === "breakout_end") {
        rooms.delete(data.breakout_uuid);
        pending.delete(data.breakout_uuid);
        return;
      }
      if (event === "breakout_event") {
        applyRosterEvent(
          rooms,
          pending,
          displayNames,
          protocols,
          serviceTypes,
          waitingStates,
          data.breakout_uuid,
          data.event,
          data.data,
        );
        return;
      }
      applyRosterEvent(
        rooms,
        pending,
        displayNames,
        protocols,
        serviceTypes,
        waitingStates,
        "main",
        event,
        data,
      );
    },
  }).catch((error) => {
    if (error?.name !== "AbortError") failure = error;
  });
  return {
    get(roomId) {
      if (failure) throw failure;
      return new Set(rooms.get(roomId) ?? []);
    },
    getMovable(roomId) {
      if (failure) throw failure;
      return new Set(
        [...(rooms.get(roomId) ?? [])].filter((participantId) =>
          isMovableParticipant(
            participantId,
            protocols,
            serviceTypes,
            waitingStates,
          ),
        ),
      );
    },
    getApi(roomId) {
      if (failure) throw failure;
      return new Set(
        [...(rooms.get(roomId) ?? [])].filter(
          (participantId) =>
            !isMovableParticipant(
              participantId,
              protocols,
              serviceTypes,
              waitingStates,
            ),
        ),
      );
    },
    findByDisplayName(roomId, displayName) {
      if (failure) throw failure;
      return [...(rooms.get(roomId) ?? [])].find(
        (participantId) => displayNames.get(participantId) === displayName,
      );
    },
    findNewMovableParticipant(roomId, previousMembership) {
      if (failure) throw failure;
      return [...(rooms.get(roomId) ?? [])].find(
        (participantId) =>
          !previousMembership.has(participantId) &&
          isMovableParticipant(
            participantId,
            protocols,
            serviceTypes,
            waitingStates,
          ),
      );
    },
    locations(participantId) {
      if (failure) throw failure;
      return [...rooms]
        .filter(([, members]) => members.has(participantId))
        .map(([roomId]) => roomId);
    },
    async stop() {
      abort.abort();
      await task;
    },
  };
}

async function consumeRosterEvents(body, options) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return;
    buffer += decoder.decode(chunk.value, { stream: true });
    let separator = buffer.match(/\r?\n\r?\n/);
    while (separator) {
      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      const parsed = parseSseBlock(block);
      if (parsed.data !== undefined) options.onEvent(parsed.event, parsed.data);
      separator = buffer.match(/\r?\n\r?\n/);
    }
  }
}

function parseSseBlock(block) {
  let event = "message";
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return { event, data: undefined };
  return { event, data: JSON.parse(data.join("\n")) };
}

function applyRosterEvent(
  rooms,
  pending,
  displayNames,
  protocols,
  serviceTypes,
  waitingStates,
  roomId,
  event,
  participant,
) {
  if (event === "participant_sync_begin") {
    pending.set(roomId, new Set());
    return;
  }
  if (event === "participant_sync_end") {
    if (pending.has(roomId)) rooms.set(roomId, pending.get(roomId));
    pending.delete(roomId);
    return;
  }
  if (
    (event === "participant_create" || event === "participant_update") &&
    typeof participant?.uuid === "string"
  ) {
    const displayName = participant.display_name ?? participant.displayName;
    if (typeof displayName === "string") {
      displayNames.set(participant.uuid, displayName);
    }
    if (typeof participant.protocol === "string") {
      protocols.set(participant.uuid, participant.protocol);
    }
    const serviceType = participant.service_type ?? participant.serviceType;
    if (typeof serviceType === "string") {
      serviceTypes.set(participant.uuid, serviceType);
    }
    const isWaiting = participant.is_waiting ?? participant.isWaiting;
    if (typeof isWaiting === "boolean") {
      waitingStates.set(participant.uuid, isWaiting);
    } else if (serviceType === "waiting_room") {
      waitingStates.set(participant.uuid, true);
    }
    for (const [candidateRoomId, members] of rooms) {
      if (candidateRoomId !== roomId) members.delete(participant.uuid);
    }
    for (const [candidateRoomId, members] of pending) {
      if (candidateRoomId !== roomId) members.delete(participant.uuid);
    }
    const target = pending.get(roomId) ?? rooms.get(roomId) ?? new Set();
    target.add(participant.uuid);
    if (!pending.has(roomId)) rooms.set(roomId, target);
    return;
  }
  if (
    (event === "participant_delete" || event === "participant_left") &&
    typeof participant?.uuid === "string"
  ) {
    (pending.get(roomId) ?? rooms.get(roomId))?.delete(participant.uuid);
  }
}

function isMovableParticipant(
  participantId,
  protocols,
  serviceTypes,
  waitingStates,
) {
  return (
    protocols.get(participantId)?.toLowerCase() !== "api" ||
    waitingStates.get(participantId) === true ||
    serviceTypes.get(participantId) === "waiting_room"
  );
}

async function waitForMembership(tracker, expected) {
  const deadline = Date.now() + 25_000;
  let last = {};
  while (Date.now() < deadline) {
    let matches = true;
    for (const [roomId, ids] of Object.entries(expected.present ?? {})) {
      const membership = tracker.get(roomId);
      last[hash(roomId)] = membership.size;
      if (!ids.every((id) => membership.has(id))) matches = false;
    }
    for (const [roomId, ids] of Object.entries(expected.absent ?? {})) {
      const membership = tracker.get(roomId);
      last[hash(roomId)] = membership.size;
      if (ids.some((id) => membership.has(id))) matches = false;
    }
    if (matches) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const allParticipantIds = new Set([
    ...Object.values(expected.present ?? {}).flat(),
    ...Object.values(expected.absent ?? {}).flat(),
  ]);
  const locations = Object.fromEntries(
    [...allParticipantIds].map((participantId) => [
      hash(participantId),
      tracker.locations(participantId).map(hash),
    ]),
  );
  throw new Error(
    `Timed out waiting for expected room membership: ${JSON.stringify({ counts: last, locations })}`,
  );
}

async function waitForTransferredParticipants(tracker, expected) {
  const deadline = Date.now() + 45_000;
  let last = {};
  while (Date.now() < deadline) {
    const destination = tracker.getMovable(expected.destinationRoomId);
    const replacements = [...destination].filter(
      (participantId) => !expected.destinationBefore.has(participantId),
    );
    const previousGone = expected.previousIds.every(
      (participantId) => tracker.locations(participantId).length === 0,
    );
    const unchanged = Object.entries(expected.unchanged ?? {}).every(
      ([roomId, participantIds]) => {
        const members = tracker.get(roomId);
        return participantIds.every((participantId) =>
          members.has(participantId),
        );
      },
    );
    last = {
      destinationCount: destination.size,
      replacementCount: replacements.length,
      previousGone,
      unchanged,
    };
    if (replacements.length === expected.previousIds.length && unchanged) {
      return replacements;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for transferred participants: ${JSON.stringify(last)}`,
  );
}

async function clickControl(page, labelPrefix) {
  const button = controlLocator(page, labelPrefix).first();
  await button.waitFor({ state: "attached", timeout: 30_000 });
  // Webapp3 intentionally auto-hides its toolbar and can place the video
  // surface over it between Playwright's actionability check and the click.
  // Invoking the real button element is deterministic and still exercises the
  // Webapp3 -> plugin click event path.
  await button.evaluate((element) => element.click());
}

function controlLocator(page, labelPrefix) {
  return page
    .locator("button")
    .filter({ hasText: labelPrefix })
    .or(
      page.locator(
        `button[title*="${labelPrefix}"], button[aria-label*="${labelPrefix}"]`,
      ),
    );
}

async function waitForControl(page, labelPrefix, timeout) {
  await controlLocator(page, labelPrefix)
    .first()
    .waitFor({ state: "attached", timeout });
}

async function revealMeetingControls(page) {
  await page.mouse.move(720, 500);
  await page.mouse.move(20, 500, { steps: 4 });
  await page.waitForTimeout(400);
}

async function advanceIntoMeeting(page, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await clickJoinControls(page);
    if (
      await page
        .locator("button")
        .evaluateAll(
          (buttons) =>
            buttons.filter((button) => {
              const style = getComputedStyle(button);
              const box = button.getBoundingClientRect();
              return (
                style.visibility !== "hidden" &&
                style.display !== "none" &&
                box.width > 0 &&
                box.height > 0
              );
            }).length >= 2,
        )
        .catch(() => false)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("Webapp3 did not expose an interactive meeting surface");
}

async function clickJoinControls(page) {
  const joinLabels = [
    /proceed/i,
    /^join$/i,
    /join now/i,
    /join meeting/i,
    /continue/i,
    /deelnemen/i,
    /doorgaan/i,
  ];
  for (const label of joinLabels) {
    const candidate = page.getByRole("button", { name: label }).first();
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click().catch(() => undefined);
    }
  }
}

async function waitForPluginRoster(page, expected) {
  const deadline = Date.now() + 60_000;
  let last = {};
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (!isCourtPluginUrl(frame.url())) continue;
      const result = await frame
        .evaluate((wanted) => {
          const latest = new Map();
          for (const entry of window.__courtPluginMessages ?? []) {
            if (entry.event === "event:participants") {
              latest.set(
                entry.payload.id,
                new Map(
                  (entry.payload.participants ?? []).map((participant) => [
                    participant.uuid,
                    participant,
                  ]),
                ),
              );
              continue;
            }
            if (entry.event !== "event:participantsActivities") continue;
            for (const { roomId, activity } of entry.payload ?? []) {
              if (activity.type === 1) {
                latest.get(roomId)?.delete(activity.participant.uuid);
                continue;
              }
              for (const participants of latest.values()) {
                participants.delete(activity.participant.uuid);
              }
              const participants = latest.get(roomId) ?? new Map();
              participants.set(activity.participant.uuid, activity.participant);
              latest.set(roomId, participants);
            }
          }
          const counts = {};
          let matches = true;
          for (const [roomId, ids] of Object.entries(wanted)) {
            const participantIds = new Set(latest.get(roomId)?.keys() ?? []);
            counts[roomId] = participantIds.size;
            if (!ids.every((id) => participantIds.has(id))) matches = false;
          }
          return { matches, counts };
        }, expected)
        .catch(() => undefined);
      if (!result) continue;
      last = result.counts;
      if (result.matches) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Plugin did not receive the expected breakout roster: ${JSON.stringify(
      Object.fromEntries(
        Object.entries(last).map(([roomId, count]) => [hash(roomId), count]),
      ),
    )}`,
  );
}

async function collectWebappDiagnostics(page) {
  const surface = await page.evaluate(() => ({
    title: document.title,
    visibleButtons: [...document.querySelectorAll("button")]
      .filter((button) => {
        const style = getComputedStyle(button);
        const box = button.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          box.width > 0 &&
          box.height > 0
        );
      })
      .slice(0, 30)
      .map((button) => ({
        text: button.textContent?.trim().slice(0, 100) ?? "",
        title: button.getAttribute("title")?.slice(0, 100) ?? "",
        ariaLabel: button.getAttribute("aria-label")?.slice(0, 100) ?? "",
      })),
    notices: [...document.querySelectorAll('[role="alert"], [role="status"]')]
      .map((element) => element.textContent?.trim().slice(0, 200) ?? "")
      .filter(Boolean)
      .slice(0, 10),
  }));
  const pluginFrames = [];
  for (const frame of page.frames()) {
    if (!isCourtPluginUrl(frame.url())) continue;
    pluginFrames.push(
      await frame.evaluate(() => ({
        rpcCounts: (window.__courtPluginMessages ?? []).reduce(
          (counts, entry) => {
            const key = entry.rpc ?? entry.event ?? "reply";
            counts[key] = (counts[key] ?? 0) + 1;
            return counts;
          },
          {},
        ),
        actions: (window.__courtPluginMessages ?? [])
          .filter(
            (entry) =>
              entry.rpc === "conference:breakoutMoveParticipants" ||
              entry.rpc === "ui:toast:show" ||
              entry.replyTo,
          )
          .slice(-20)
          .map((entry) => ({
            id: entry.id,
            rpc: entry.rpc,
            replyTo: entry.replyTo,
            status: entry.payload?.status,
            danger:
              entry.rpc === "ui:toast:show"
                ? Boolean(entry.payload?.isDanger)
                : undefined,
            message:
              entry.rpc === "ui:toast:show"
                ? String(entry.payload?.message ?? "").slice(0, 200)
                : undefined,
          })),
      })),
    );
  }
  return { surface, pluginFrames };
}

async function waitForPluginRpc(page, rpc, timeout = 20_000) {
  await page.waitForFunction(
    (expected) =>
      window.__courtPluginMessages?.some((entry) => entry.rpc === expected),
    rpc,
    { timeout },
  );
}

async function waitForPluginMove(page, expected) {
  await page.waitForFunction(
    (wanted) =>
      window.__courtPluginMessages?.find(
        (entry) =>
          entry.rpc === "conference:breakoutMoveParticipants" &&
          entry.payload?.toRoomUuid === wanted.toRoomUuid &&
          entry.payload?.fromBreakoutUuid === wanted.fromBreakoutUuid &&
          JSON.stringify([...entry.payload.participants].sort()) ===
            JSON.stringify([...wanted.participants].sort()),
      ),
    expected,
    { timeout: 30_000 },
  );
}

function assertStatus(actual, expected, operation) {
  if (actual !== expected)
    throw new Error(`${operation} returned HTTP ${actual}`);
}

function assertTwoAcceptedPluginMoves(requests) {
  const outgoing = requests.filter(({ method }) => method === "POST");
  const accepted = requests.filter(
    ({ responseStatus }) => responseStatus === 200,
  );
  if (outgoing.length !== 2 || accepted.length !== 2) {
    throw new Error("Pexip did not accept both scoped participant moves");
  }
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function isCourtPluginUrl(value) {
  try {
    const url = new URL(value);
    return url.pathname.includes("/branding/plugins/courts-control-plugin/");
  } catch {
    return false;
  }
}
