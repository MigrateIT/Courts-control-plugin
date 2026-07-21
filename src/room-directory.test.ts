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
    const directory = new RoomDirectory();
    directory.recordBreakout(roomA);

    const [room] = directory.listBreakouts();
    expect(room?.id).toBe(roomA);
    expect(room?.name).toMatch(/^Waiting room /);
    expect(room?.participantIds).toEqual([]);
  });

  it("counts an unadmitted api participant from the room snapshot", () => {
    const directory = new RoomDirectory();
    directory.recordConferenceStatus(roomA, status("Case A"));
    directory.replaceParticipants(roomA, [observer, waitingPerson]);

    expect(directory.getBreakout(roomA)).toEqual({
      id: roomA,
      name: "Case A",
      participantIds: [waitingPerson.uuid],
    });
  });

  it("keeps an api observer out of the movable participant count", () => {
    const directory = new RoomDirectory();
    directory.replaceParticipants(roomA, [observer]);

    expect(directory.getBreakout(roomA)?.participantIds).toEqual([]);
  });

  it("tracks later room moves through participant activities", () => {
    const directory = new RoomDirectory();
    directory.replaceParticipants(roomA, [observer, waitingPerson]);
    directory.applyActivities([
      leave(roomA, waitingPerson),
      join("main", waitingPerson),
    ]);

    expect(directory.getBreakout(roomA)?.participantIds).toEqual([]);
  });

  it("sorts rooms by display name and ignores main status naming", () => {
    const directory = new RoomDirectory();
    directory.recordConferenceStatus(roomA, status("Zulu"));
    directory.recordConferenceStatus(roomB, status("Alpha"));
    directory.recordConferenceStatus("main", status("Ignored"));

    expect(directory.listBreakouts().map(({ name }) => name)).toEqual([
      "Alpha",
      "Zulu",
    ]);
  });

  it("removes a room when Pexip announces breakout end", () => {
    const directory = new RoomDirectory();
    directory.recordBreakout(roomA);
    directory.removeBreakout(roomA);

    expect(directory.getBreakout(roomA)).toBeUndefined();
  });
});

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
