import {
  type ConferenceStatus,
  type InfinityParticipant,
  type ParticipantID,
  type RoomID,
  type RoomParticipantActivity,
} from "@pexip/plugin-api";
import type { ParticipantSummary, RoomSummary } from "./types";

type BreakoutRoomId = Exclude<RoomID, "main">;
const participantLeaveActivity =
  1 as RoomParticipantActivity["activity"]["type"];

type RoomRecord = {
  id: BreakoutRoomId;
  name?: string;
  participants: Map<ParticipantID, ParticipantSummary>;
};

export class RoomDirectory {
  private readonly rooms = new Map<BreakoutRoomId, RoomRecord>();
  private readonly mainParticipants = new Map<
    ParticipantID,
    ParticipantSummary
  >();

  recordBreakout(roomId: BreakoutRoomId, participantId?: ParticipantID): void {
    const room = this.ensureRoom(roomId);
    if (participantId !== undefined && !room.participants.has(participantId)) {
      this.removeParticipantFromAllRooms(participantId);
      room.participants.set(participantId, participantSummary(participantId));
    }
  }

  removeBreakout(roomId: BreakoutRoomId): void {
    this.rooms.delete(roomId);
  }

  recordConferenceStatus(roomId: RoomID, status: ConferenceStatus): void {
    if (roomId === "main") return;
    const room = this.ensureRoom(roomId);
    const name = status.breakoutName?.trim();
    if (name) room.name = name;
  }

  replaceParticipants(
    roomId: RoomID,
    participants: readonly InfinityParticipant[],
  ): void {
    const target =
      roomId === "main"
        ? this.mainParticipants
        : this.ensureRoom(roomId).participants;
    const nextIds = new Set(participants.map(({ uuid }) => uuid));

    for (const existingId of target.keys()) {
      if (!nextIds.has(existingId)) target.delete(existingId);
    }
    for (const participant of participants) {
      this.moveParticipantToRoom(roomId, participant);
    }
  }

  recordParticipant(roomId: RoomID, participant: InfinityParticipant): void {
    this.moveParticipantToRoom(roomId, participant);
  }

  removeParticipant(participantId: ParticipantID): void {
    this.removeParticipantFromAllRooms(participantId);
  }

  applyActivities(activities: readonly RoomParticipantActivity[]): void {
    for (const { roomId, activity } of activities) {
      if (activity.type === participantLeaveActivity) {
        this.removeParticipant(activity.participant.uuid);
      } else {
        this.moveParticipantToRoom(roomId, activity.participant);
      }
    }
  }

  listBreakouts(): readonly RoomSummary[] {
    return [...this.rooms.values()]
      .map((room) => ({
        id: room.id,
        name: room.name ?? fallbackRoomName(room.id),
        participantIds: movableParticipantIds(room.participants),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getBreakout(roomId: string): RoomSummary | undefined {
    const room = this.rooms.get(roomId as BreakoutRoomId);
    if (!room) return undefined;
    return {
      id: room.id,
      name: room.name ?? fallbackRoomName(room.id),
      participantIds: movableParticipantIds(room.participants),
    };
  }

  private ensureRoom(roomId: BreakoutRoomId): RoomRecord {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const room: RoomRecord = { id: roomId, participants: new Map() };
    this.rooms.set(roomId, room);
    return room;
  }

  private moveParticipantToRoom(
    roomId: RoomID,
    participant: InfinityParticipant,
  ): void {
    this.removeParticipantFromAllRooms(participant.uuid);
    const summary = participantSummary(participant.uuid, participant);
    if (roomId === "main") {
      this.mainParticipants.set(participant.uuid, summary);
    } else {
      this.ensureRoom(roomId).participants.set(participant.uuid, summary);
    }
  }

  private removeParticipantFromAllRooms(participantId: ParticipantID): void {
    this.mainParticipants.delete(participantId);
    for (const room of this.rooms.values())
      room.participants.delete(participantId);
  }
}

function participantSummary(
  uuid: ParticipantID,
  participant?: InfinityParticipant,
): ParticipantSummary {
  return {
    uuid,
    isControlOnly:
      participant === undefined ||
      participant.protocol?.toLowerCase() === "api",
  };
}

function movableParticipantIds(
  participants: ReadonlyMap<ParticipantID, ParticipantSummary>,
): ParticipantID[] {
  return [...participants.values()]
    .filter((participant) => !participant.isControlOnly)
    .map(({ uuid }) => uuid);
}

function fallbackRoomName(roomId: BreakoutRoomId): string {
  const suffix = String(roomId).replaceAll("-", "").slice(0, 8);
  return `Waiting room ${suffix || "unknown"}`;
}
