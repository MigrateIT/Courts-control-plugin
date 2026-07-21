import { registerPlugin, type Button, type RoomID } from "@pexip/plugin-api";
import { PLUGIN_ID, PLUGIN_VERSION } from "./constants";
import {
  EmptyRoomError,
  HearingActionInProgressError,
  HearingController,
} from "./hearing-controller";
import { resolveLocale, translate, type Locale } from "./i18n";
import { assertSuccessfulMoveResponse } from "./move-response";
import { RoomDirectory } from "./room-directory";
import type { MoveParticipantsRequest, RoomSummary } from "./types";

const plugin = await registerPlugin({ id: PLUGIN_ID, version: PLUGIN_VERSION });
const directory = new RoomDirectory();

let locale: Locale = resolveLocale(navigator.language);
let startLauncher: Button<"toolbar"> | null = null;
let returnLauncher: Button<"toolbar"> | null = null;
let meetingAvailable = false;
let reconcileChain = Promise.resolve();

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

plugin.events.me.add(({ id, participant }) => {
  directory.recordParticipant(id, participant);
});

plugin.events.breakoutBegin.add(
  ({ breakout_uuid: roomId, participant_uuid: participantId }) => {
    directory.recordBreakout(asBreakoutRoomId(roomId), participantId);
    scheduleReconcile();
  },
);

plugin.events.breakoutEnd.add(({ breakout_uuid: roomId }) => {
  directory.removeBreakout(asBreakoutRoomId(roomId));
  scheduleReconcile();
});

plugin.events.participants.add(({ id, participants }) => {
  directory.replaceParticipants(id, participants);
  scheduleReconcile();
});

plugin.events.participantJoined.add(({ id, participant }) => {
  directory.recordParticipant(id, participant);
  scheduleReconcile();
});

plugin.events.participantLeft.add(({ participant }) => {
  directory.removeParticipant(participant.uuid);
  scheduleReconcile();
});

plugin.events.participantsActivities.add((activities) => {
  directory.applyActivities(activities);
  scheduleReconcile();
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

  const busy = controller.isBusy();
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
    tooltip: translate(locale, busy ? "toolbarBusy" : "toolbarStart"),
    isActive: false,
    isDisabled: busy,
  };
}

function returnLauncherPayload(busy: boolean) {
  return {
    position: "toolbar" as const,
    roles: ["chair" as const],
    icon: "IconPause",
    tooltip: translate(locale, busy ? "toolbarBusy" : "toolbarReturn"),
    isActive: false,
    isDisabled: busy,
  };
}

async function selectAndStartHearing(): Promise<void> {
  const rooms = directory
    .listBreakouts()
    .filter((room) => room.participantIds.length > 0);
  if (rooms.length === 0) {
    await showToast("noWaitingRooms", true);
    return;
  }

  const input = await plugin.ui.showForm({
    title: translate(locale, "selectTitle"),
    description: translate(locale, "selectDescription"),
    form: {
      elements: {
        room: {
          name: translate(locale, "selectRoom"),
          type: "select" as const,
          options: rooms.map(roomOption),
          selected: rooms[0]?.id,
        },
      },
      submitBtnTitle: translate(locale, "selectSubmit"),
    },
  });

  const selected = directory.getBreakout(input.room);
  if (!selected || selected.participantIds.length === 0) {
    await showToast("roomUnavailable", true);
    return;
  }

  try {
    scheduleReconcile();
    const started = await controller.start(selected);
    await showToast("hearingStarted", false, {
      count: started.participantCount,
      room: started.roomName,
    });
  } catch (error) {
    await reportActionError(error);
  } finally {
    scheduleReconcile();
  }
}

async function pauseHearing(): Promise<void> {
  try {
    scheduleReconcile();
    await controller.pause();
    await showToast("hearingPaused");
  } catch (error) {
    await reportActionError(error);
  } finally {
    scheduleReconcile();
  }
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
    label: `${room.name} (${room.participantIds.length})`,
  };
}

async function showToast(
  key: Parameters<typeof translate>[1],
  isDanger = false,
  values?: Readonly<Record<string, string | number>>,
): Promise<void> {
  await plugin.ui.showToast({
    message: translate(locale, key, values),
    isDanger,
    isInterrupt: true,
    canDismiss: true,
    timeout: 5000,
  });
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
