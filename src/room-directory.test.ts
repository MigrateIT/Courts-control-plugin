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
const personA = participant("person-a", "Person A");
const personB = participant("person-b", "Person B", true);

describe("RoomDirectory", () => {
  it("builds named breakout rosters from status and participant snapshots", () => {
    const directory = new RoomDirectory();
    directory.recordConferenceStatus(roomA, status("Case A"));
    directory.replaceParticipants(roomA, [personA, personB]);

    expect(directory.listBreakouts()).toEqual([
      {
        id: roomA,
        name: "Case A",
        participantIds: [personA.uuid, personB.uuid],
      },
    ]);
  });

  it("moves a participant between rooms instead of duplicating it", () => {
    const directory = new RoomDirectory();
    directory.replaceParticipants(roomA, [personA]);
    directory.recordParticipant(roomB, personA);

    expect(directory.getBreakout(roomA)?.participantIds).toEqual([]);
    expect(directory.getBreakout(roomB)?.participantIds).toEqual([
      personA.uuid,
    ]);
    directory.recordParticipant("main", personA);
    expect(directory.getBreakout(roomB)?.participantIds).toEqual([]);
  });

  it("applies modern join, update, and leave activities", () => {
    const directory = new RoomDirectory();
    directory.applyActivities([
      {
        roomId: roomA,
        activity: { type: 0 as ParticipantActivities, participant: personA },
      },
      {
        roomId: roomB,
        activity: { type: 2 as ParticipantActivities, participant: personB },
      },
    ]);
    directory.applyActivities([
      {
        roomId: roomA,
        activity: { type: 1 as ParticipantActivities, participant: personA },
      },
    ]);

    expect(directory.getBreakout(roomA)?.participantIds).toEqual([]);
    expect(directory.getBreakout(roomB)?.participantIds).toEqual([
      personB.uuid,
    ]);
  });

  it("uses breakout begin as early roster evidence and removes ended rooms", () => {
    const directory = new RoomDirectory();
    directory.recordBreakout(roomA, personA.uuid);
    directory.recordBreakout(roomA, personA.uuid);
    expect(directory.getBreakout(roomA)?.participantIds).toEqual([]);
    expect(directory.getBreakout(roomA)?.name).toMatch(/^Waiting room /);
    directory.removeBreakout(roomA);
    expect(directory.getBreakout(roomA)).toBeUndefined();
  });

  it("removes participants absent from a replacement snapshot", () => {
    const directory = new RoomDirectory();
    directory.replaceParticipants(roomA, [personA, personB]);
    directory.replaceParticipants(roomA, [personB]);
    expect(directory.getBreakout(roomA)?.participantIds).toEqual([
      personB.uuid,
    ]);
    directory.removeParticipant(personB.uuid);
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

  it("excludes Pexip API control legs from case participant moves", () => {
    const directory = new RoomDirectory();
    const controlLeg = {
      ...participant("control-leg", "Breakout control", true),
      protocol: "api",
    } as InfinityParticipant;
    directory.replaceParticipants(roomA, [controlLeg, personA]);

    expect(directory.getBreakout(roomA)?.participantIds).toEqual([
      personA.uuid,
    ]);
  });
});

function participant(
  id: string,
  displayName: string,
  isHost = false,
): InfinityParticipant {
  return {
    uuid: id as ParticipantID,
    displayName,
    isHost,
    protocol: "WebRTC",
  } as unknown as InfinityParticipant;
}

function status(breakoutName?: string): ConferenceStatus {
  return { breakoutName } as ConferenceStatus;
}
