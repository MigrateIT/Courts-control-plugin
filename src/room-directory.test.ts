import {
  type ConferenceStatus,
  type InfinityParticipant,
  type ParticipantActivities,
  type ParticipantID,
  type RoomID,
} from "@pexip/plugin-api";
import { describe, expect, it } from "vitest";
import { RoomDirectory } from "./room-directory";

const roomA = "breakout-a" as Exclude<RoomID, "main">;
const roomB = "breakout-b" as Exclude<RoomID, "main">;
const waitingPerson = participant(
  "waiting-person",
  "Waiting Person",
  "api",
  true,
);
const observer = participant("mmm-observer", "MMM observer", "api", false);

describe("RoomDirectory", () => {
  it("lists a breakout as soon as Pexip announces it", () => {
    const directory = roomDirectory();
    directory.recordBreakout(roomA);

    const [room] = directory.listBreakouts();
    expect(room?.id).toBe(roomA);
    expect(room?.name).toBe("Fallback breakout");
    expect(room?.participantIds).toEqual([]);
    expect(room?.participantCount).toBeNull();
    expect(room?.occupancy).toBe("unknown");
  });

  it("counts an unadmitted api participant from the room snapshot", () => {
    const directory = roomDirectory();
    directory.recordConferenceStatus(roomA, status("Case A"));
    directory.replaceParticipants(roomA, [observer, waitingPerson]);

    expect(directory.getBreakout(roomA)).toEqual({
      id: roomA,
      name: "Case A",
      participantIds: [waitingPerson.uuid],
      participantCount: 1,
      occupancy: "occupied",
    });
  });

  it("confirms an observer-only room is empty", () => {
    const directory = roomDirectory();
    directory.replaceParticipants(roomA, [observer]);

    expect(directory.getBreakout(roomA)).toMatchObject({
      participantIds: [],
      participantCount: 0,
      occupancy: "empty",
    });
  });

  it("keeps activity-only occupancy selectable with an unknown count", () => {
    const directory = roomDirectory();
    directory.recordBreakout(roomA);
    directory.applyActivities([join(roomA, waitingPerson)]);

    expect(directory.getBreakout(roomA)).toMatchObject({
      participantIds: [waitingPerson.uuid],
      participantCount: null,
      occupancy: "occupied",
    });
  });

  it("does not infer confirmed empty from activity-only roster data", () => {
    const directory = roomDirectory();
    directory.applyActivities([
      join(roomA, waitingPerson),
      leave(roomA, waitingPerson),
    ]);

    expect(directory.getBreakout(roomA)).toMatchObject({
      participantIds: [],
      participantCount: null,
      occupancy: "unknown",
    });
  });

  it("includes api participants identified as waiting by raw service type", () => {
    const directory = roomDirectory();
    const rawWaitingPerson = {
      ...waitingPerson,
      isWaiting: false,
      serviceType: "conference",
      rawData: { service_type: "waiting_room" },
    } as unknown as InfinityParticipant;

    directory.replaceParticipants(roomA, [observer, rawWaitingPerson]);

    expect(directory.getBreakout(roomA)).toMatchObject({
      participantIds: [rawWaitingPerson.uuid],
      participantCount: 1,
      occupancy: "occupied",
    });
  });

  it("tracks later room moves through participant activities", () => {
    const directory = roomDirectory();
    directory.replaceParticipants(roomA, [observer, waitingPerson]);
    directory.applyActivities([
      leave(roomA, waitingPerson),
      join("main", waitingPerson),
    ]);

    expect(directory.getBreakout(roomA)).toMatchObject({
      participantIds: [],
      participantCount: 0,
      occupancy: "empty",
    });
  });

  it("reconciles a successful start when no move activity arrives", () => {
    const directory = roomDirectory();
    const lateArrival = participant(
      "late-arrival",
      "Late Arrival",
      "api",
      true,
    );
    directory.replaceParticipants(roomA, [
      observer,
      waitingPerson,
      lateArrival,
    ]);

    directory.recordParticipantsMovedToMain(roomA, [waitingPerson.uuid]);

    expect(directory.getBreakout(roomA)).toMatchObject({
      participantIds: [lateArrival.uuid],
      participantCount: 1,
      occupancy: "occupied",
    });
  });

  it("sorts rooms by display name and ignores main status naming", () => {
    const directory = roomDirectory();
    directory.recordConferenceStatus(roomA, status("Zulu"));
    directory.recordConferenceStatus(roomB, status("Alpha"));
    directory.recordConferenceStatus("main", status("Ignored"));

    expect(directory.listBreakouts().map(({ name }) => name)).toEqual([
      "Alpha",
      "Zulu",
    ]);
  });

  it("removes a room when Pexip announces breakout end", () => {
    const directory = roomDirectory();
    directory.recordBreakout(roomA);
    directory.removeBreakout(roomA);

    expect(directory.getBreakout(roomA)).toBeUndefined();
  });
});

function roomDirectory(): RoomDirectory {
  return new RoomDirectory((suffix) => `Fallback ${suffix || "unknown"}`);
}

function participant(
  id: string,
  displayName: string,
  protocol: "WebRTC" | "api",
  isWaiting: boolean,
): InfinityParticipant {
  return {
    uuid: id as ParticipantID,
    displayName,
    protocol,
    isWaiting,
    serviceType: isWaiting ? "waiting_room" : "conference",
  } as unknown as InfinityParticipant;
}

function status(breakoutName?: string): ConferenceStatus {
  return { breakoutName } as ConferenceStatus;
}

function join(roomId: RoomID, person: InfinityParticipant) {
  return {
    roomId,
    activity: { type: 0 as ParticipantActivities, participant: person },
  };
}

function leave(roomId: RoomID, person: InfinityParticipant) {
  return {
    roomId,
    activity: { type: 1 as ParticipantActivities, participant: person },
  };
}
