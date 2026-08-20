import {
  registerPlugin,
  type Button,
  type ParticipantID,
  type RoomID,
} from "@pexip/plugin-api";
import { PLUGIN_ID, PLUGIN_VERSION } from "./constants";
import {
  countdownCancelledMessage,
  countdownStartedMessage,
  hearingPausedMessage,
  hearingStartedMessage,
  parseHostApplicationMessage,
  type CountdownAction,
} from "./application-message";
import { loadConfiguration } from "./configuration";
import {
  EmptyRoomError,
  HearingActionInProgressError,
  HearingController,
} from "./hearing-controller";
import {
  resolveLocale,
  translate,
  type Locale,
  type TranslationKey,
} from "./i18n";
import { assertSuccessfulMoveResponse } from "./move-response";
import { RoomDirectory } from "./room-directory";
import type { MoveParticipantsRequest, RoomSummary } from "./types";

const [configuration, plugin] = await Promise.all([
  loadConfiguration(
    new URL("./assets/configuration.json", globalThis.location.href),
  ),
  registerPlugin({ id: PLUGIN_ID, version: PLUGIN_VERSION }),
]);
const allWaitingRoomsOption = "__all_waiting_rooms__";
const countdownSeconds = configuration.countdownSeconds;

let locale: Locale = resolveLocale(navigator.language);
const directory = new RoomDirectory((suffix) =>
  localize("roomFallback", { suffix }),
);
let startLauncher: Button<"toolbar"> | null = null;
let returnLauncher: Button<"toolbar"> | null = null;
let meetingAvailable = false;
let actionHoldActive = false;
let reconcileChain = Promise.resolve();
let localParticipantId: ParticipantID | null = null;
const remoteCountdowns = new Map<string, () => void>();

const controller = new HearingController({
  moveParticipants: async (request: MoveParticipantsRequest) => {
    // Pexip's REST API supports the standard `previous` destination, while the
    // current plugin SDK types only list a breakout UUID or `main`.
    const response = await plugin.conference.breakoutMoveParticipants(
      request as Parameters<
        typeof plugin.conference.breakoutMoveParticipants
      >[0],
    );
    assertSuccessfulMoveResponse(response);
  },
});

plugin.events.conferenceStatus.add(({ id, status }) => {
  directory.recordConferenceStatus(id, status);
  if (status.started && !status.directMedia) meetingAvailable = true;
  scheduleReconcile();
});

plugin.events.breakoutBegin.add(({ breakout_uuid: roomId }) => {
  directory.recordBreakout(asBreakoutRoomId(roomId));
  scheduleReconcile();
});

plugin.events.breakoutEnd.add(({ breakout_uuid: roomId }) => {
  directory.removeBreakout(asBreakoutRoomId(roomId));
  scheduleReconcile();
});

// participantsActivities reports changes after subscription. The room-scoped
// snapshot supplies participants who were already waiting when the plugin loaded.
plugin.events.participants.add(({ id, participants }) => {
  directory.replaceParticipants(id, participants);
  scheduleReconcile();
});

plugin.events.participantsActivities.add((activities) => {
  directory.applyActivities(activities);
  scheduleReconcile();
});

plugin.events.me.add(({ participant }) => {
  localParticipantId = participant.uuid;
});

plugin.events.applicationMessage.add(({ message, userId }) => {
  if (userId === localParticipantId) return;

  const hostMessage = parseHostApplicationMessage(message);
  if (!hostMessage) return;

  if (hostMessage.type === "hearing-countdown-cancelled") {
    finishRemoteCountdown(hostMessage.operationId);
    return;
  }

  if (hostMessage.type === "hearing-countdown-started") {
    if (
      countdownSeconds === 0 ||
      remoteCountdowns.has(hostMessage.operationId)
    ) {
      return;
    }
    const cancel = startRemoteCountdown(
      hostMessage.action,
      hostMessage.seconds,
      () => {
        if (remoteCountdowns.get(hostMessage.operationId) === cancel) {
          remoteCountdowns.delete(hostMessage.operationId);
          scheduleReconcile();
        }
      },
    );
    remoteCountdowns.set(hostMessage.operationId, cancel);
    scheduleReconcile();
    return;
  }

  if (hostMessage.type === "hearing-started") {
    finishRemoteCountdown(hostMessage.operationId);
    void showToast(
      startedToastKey(hostMessage.allRooms, hostMessage.participantCount),
      false,
      startedToastValues(hostMessage.participantCount, hostMessage.roomName),
    ).catch(reportSharedToastError);
    return;
  }

  finishRemoteCountdown(hostMessage.operationId);
  void showToast("hearingPaused").catch(reportSharedToastError);
});

plugin.events.languageSelect.add((language) => {
  locale = resolveLocale(language);
  scheduleReconcile();
});

function scheduleReconcile(): void {
  reconcileChain = reconcileChain.then(reconcileLauncher, reconcileLauncher);
}

async function reconcileLauncher(): Promise<void> {
  if (!meetingAvailable) {
    await removeLaunchers();
    return;
  }

  const busy = isHearingActionActive();
  if (!startLauncher) {
    startLauncher = await plugin.ui.addButton(startLauncherPayload(busy));
    startLauncher.onClick.add(() => void selectAndStartHearing());
  } else {
    await startLauncher.update(startLauncherPayload(busy));
  }
  if (!returnLauncher) {
    returnLauncher = await plugin.ui.addButton(returnLauncherPayload(busy));
    returnLauncher.onClick.add(() => void pauseHearing());
  } else {
    await returnLauncher.update(returnLauncherPayload(busy));
  }
}

function startLauncherPayload(busy: boolean) {
  return {
    position: "toolbar" as const,
    roles: ["chair" as const],
    icon: "IconPlay",
    tooltip: localize(busy ? "toolbarBusy" : "toolbarStart"),
    isActive: false,
    isDisabled: busy,
  };
}

function returnLauncherPayload(busy: boolean) {
  return {
    position: "toolbar" as const,
    roles: ["chair" as const],
    icon: "IconPause",
    tooltip: localize(busy ? "toolbarBusy" : "toolbarReturn"),
    isActive: false,
    isDisabled: busy,
  };
}

async function selectAndStartHearing(): Promise<void> {
  if (isHearingActionActive()) {
    await showToast("actionBusy");
    return;
  }

  const rooms = directory
    .listBreakouts()
    .filter((room) => room.occupancy !== "empty");
  if (rooms.length === 0) {
    await showToast("noWaitingRooms", true);
    return;
  }

  const input = await plugin.ui.showForm({
    title: localize("selectTitle"),
    description: localize("selectDescription"),
    form: {
      elements: {
        room: {
          name: localize("selectRoom"),
          type: "select" as const,
          options: [
            {
              id: allWaitingRoomsOption,
              label: localize("selectAll"),
            },
            ...rooms.map(roomOption),
          ],
          selected: allWaitingRoomsOption,
        },
      },
      submitBtnTitle: localize("selectSubmit"),
    },
  });

  if (!input?.room) return;

  // Another host can start a countdown while this form is open.
  if (isHearingActionActive()) {
    await showToast("actionBusy");
    return;
  }

  if (input.room === allWaitingRoomsOption) {
    const availableRooms = directory
      .listBreakouts()
      .filter((room) => room.occupancy !== "empty");
    if (availableRooms.length === 0) {
      await showToast("roomUnavailable", true);
      return;
    }
    await startRooms(availableRooms, true);
    return;
  }

  const selected = directory.getBreakout(input.room);
  if (!selected || selected.occupancy === "empty") {
    await showToast("roomUnavailable", true);
    return;
  }

  await startRooms([selected], false);
}

async function startRooms(
  rooms: readonly RoomSummary[],
  allRooms: boolean,
): Promise<void> {
  if (isHearingActionActive()) {
    await showToast("actionBusy");
    return;
  }

  actionHoldActive = true;
  const operationId = globalThis.crypto.randomUUID();
  try {
    scheduleReconcile();
    const start = allRooms
      ? controller.startAll(rooms)
      : controller.start(rooms[0]!);
    if (countdownSeconds > 0) {
      broadcastCountdown(
        countdownStartedMessage(operationId, countdownSeconds, "start"),
      );
    }
    const started =
      countdownSeconds > 0 ? await withCountdown(start, "start") : await start;
    for (const room of rooms) {
      directory.recordParticipantsMovedToMain(room.id, room.participantIds);
    }
    scheduleReconcile();
    broadcastApplicationMessage(
      hearingStartedMessage(operationId, {
        allRooms,
        participantCount: started.participantCount,
        roomName: started.roomName,
      }),
    );
    await showToast(
      startedToastKey(allRooms, started.participantCount),
      false,
      startedToastValues(started.participantCount, started.roomName),
    );
  } catch (error) {
    if (countdownSeconds > 0) {
      broadcastCountdown(countdownCancelledMessage(operationId));
    }
    await reportActionError(error);
  } finally {
    actionHoldActive = false;
    scheduleReconcile();
  }
}

async function withCountdown<T>(
  action: Promise<T>,
  countdownAction: CountdownAction,
): Promise<T> {
  let seconds = countdownSeconds;
  showCountdownToast(countdownAction, seconds);
  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
  const countdown = new Promise<void>((resolve) => {
    timer = globalThis.setInterval(() => {
      seconds -= 1;
      if (seconds > 0) {
        showCountdownToast(countdownAction, seconds);
      } else {
        globalThis.clearInterval(timer);
        resolve();
      }
    }, 1000);
  });

  try {
    const [result] = await Promise.all([action, countdown]);
    return result;
  } finally {
    globalThis.clearInterval(timer);
  }
}

function startRemoteCountdown(
  countdownAction: CountdownAction,
  initialSeconds: number,
  onFinished: () => void,
): () => void {
  let seconds = initialSeconds;
  let finished = false;
  showCountdownToast(countdownAction, seconds);
  const timer = globalThis.setInterval(() => {
    seconds -= 1;
    if (seconds > 0) {
      showCountdownToast(countdownAction, seconds);
    } else {
      finish();
    }
  }, 1000);

  function finish(): void {
    if (finished) return;
    finished = true;
    globalThis.clearInterval(timer);
    onFinished();
  }

  return finish;
}

function finishRemoteCountdown(operationId: string): void {
  remoteCountdowns.get(operationId)?.();
}

function broadcastCountdown(payload: Record<string, unknown>): void {
  broadcastApplicationMessage(payload, "countdown");
}

function broadcastApplicationMessage(
  payload: Record<string, unknown>,
  description = "hearing update",
): void {
  void plugin.conference
    .sendApplicationMessage({ payload })
    .catch((error) =>
      console.error(`Court ${description} could not be shared`, error),
    );
}

function showCountdownToast(
  countdownAction: CountdownAction,
  seconds: number,
): void {
  void plugin.ui
    .showToast({
      message: localize(
        countdownAction === "start"
          ? "hearingCountdown"
          : "hearingPauseCountdown",
        { seconds },
      ),
      isInterrupt: true,
      position: "topCenter",
      canDismiss: false,
      timeout: 1100,
    })
    .catch((error) => {
      console.error("Court hearing countdown could not be shown", error);
    });
}

async function pauseHearing(): Promise<void> {
  if (isHearingActionActive()) {
    await showToast("actionBusy");
    return;
  }

  actionHoldActive = true;
  const operationId = globalThis.crypto.randomUUID();
  try {
    scheduleReconcile();
    const pause = controller.pause();
    if (countdownSeconds > 0) {
      broadcastCountdown(
        countdownStartedMessage(operationId, countdownSeconds, "pause"),
      );
    }
    if (countdownSeconds > 0) {
      await withCountdown(pause, "pause");
    } else {
      await pause;
    }
    broadcastApplicationMessage(hearingPausedMessage(operationId));
    await showToast("hearingPaused");
  } catch (error) {
    if (countdownSeconds > 0) {
      broadcastCountdown(countdownCancelledMessage(operationId));
    }
    await reportActionError(error);
  } finally {
    actionHoldActive = false;
    scheduleReconcile();
  }
}

function isHearingActionActive(): boolean {
  return controller.isBusy() || actionHoldActive || remoteCountdowns.size > 0;
}

function startedToastKey(
  allRooms: boolean,
  participantCount: number | null,
): TranslationKey {
  const countKnown = participantCount !== null;
  return allRooms
    ? countKnown
      ? "hearingStartedAll"
      : "hearingStartedAllCountUnknown"
    : countKnown
      ? "hearingStarted"
      : "hearingStartedCountUnknown";
}

function startedToastValues(
  participantCount: number | null,
  roomName: string,
): Readonly<Record<string, string | number>> {
  return {
    count: participantCount ?? 0,
    room: roomName,
  };
}

function reportSharedToastError(error: unknown): void {
  console.error("Shared court hearing update could not be shown", error);
}

async function reportActionError(error: unknown): Promise<void> {
  if (error instanceof HearingActionInProgressError) {
    await showToast("actionBusy");
    return;
  }
  if (error instanceof EmptyRoomError) {
    await showToast("roomUnavailable", true);
    return;
  }
  console.error("Court hearing control action failed", error);
  await showToast("actionFailed", true);
}

function roomOption(room: RoomSummary): { id: string; label: string } {
  return {
    id: room.id,
    label:
      room.participantCount === null
        ? `${room.name} (${localize("countUnavailable")})`
        : `${room.name} (${room.participantCount})`,
  };
}

async function showToast(
  key: TranslationKey,
  isDanger = false,
  values?: Readonly<Record<string, string | number>>,
): Promise<void> {
  await plugin.ui.showToast({
    message: localize(key, values),
    isDanger,
    isInterrupt: true,
    canDismiss: true,
    timeout: 5000,
  });
}

function localize(
  key: TranslationKey,
  values?: Readonly<Record<string, string | number>>,
): string {
  return translate(configuration.localization, locale, key, values);
}

function asBreakoutRoomId(roomId: RoomID): Exclude<RoomID, "main"> {
  if (roomId === "main") throw new Error("Expected a breakout room identifier");
  return roomId;
}

async function removeLaunchers(): Promise<void> {
  if (startLauncher) {
    await startLauncher.remove();
    startLauncher = null;
  }
  if (returnLauncher) {
    await returnLauncher.remove();
    returnLauncher = null;
  }
}
