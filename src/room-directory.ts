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
  hasParticipantSnapshot: boolean;
};

export class RoomDirectory {
  private readonly rooms = new Map<BreakoutRoomId, RoomRecord>();
  private readonly mainParticipants = new Map<
    ParticipantID,
    ParticipantSummary
  >();

  recordBreakout(roomId: BreakoutRoomId): void {
    this.ensureRoom(roomId);
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
    const room = roomId === "main" ? undefined : this.ensureRoom(roomId);
    const target = room?.participants ?? this.mainParticipants;
    const nextIds = new Set(participants.map(({ uuid }) => uuid));

    for (const existingId of target.keys()) {
      if (!nextIds.has(existingId)) target.delete(existingId);
    }
    for (const participant of participants) {
      this.moveParticipantToRoom(roomId, participant);
    }
    if (room) room.hasParticipantSnapshot = true;
  }

  applyActivities(activities: readonly RoomParticipantActivity[]): void {
    for (const { roomId, activity } of activities) {
      if (activity.type === participantLeaveActivity) {
        this.removeParticipantFromRoom(roomId, activity.participant.uuid);
      } else {
        this.moveParticipantToRoom(roomId, activity.participant);
      }
    }
  }

  recordParticipantsMovedToMain(
    roomId: BreakoutRoomId,
    participantIds: readonly ParticipantID[],
  ): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    for (const participantId of participantIds) {
      const participant = room.participants.get(participantId);
      if (!participant || participant.isControlOnly) continue;
      room.participants.delete(participantId);
      this.mainParticipants.set(participantId, participant);
    }
  }

  listBreakouts(): readonly RoomSummary[] {
    return [...this.rooms.values()]
      .map(roomSummary)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getBreakout(roomId: string): RoomSummary | undefined {
    const room = this.rooms.get(roomId as BreakoutRoomId);
    if (!room) return undefined;
    return roomSummary(room);
  }

  private ensureRoom(roomId: BreakoutRoomId): RoomRecord {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const room: RoomRecord = {
      id: roomId,
      participants: new Map(),
      hasParticipantSnapshot: false,
    };
    this.rooms.set(roomId, room);
    return room;
  }

  private moveParticipantToRoom(
    roomId: RoomID,
    participant: InfinityParticipant,
  ): void {
    this.removeParticipantFromAllRooms(participant.uuid);
    const summary = participantSummary(participant);
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

  private removeParticipantFromRoom(
    roomId: RoomID,
    participantId: ParticipantID,
  ): void {
    if (roomId === "main") {
      this.mainParticipants.delete(participantId);
    } else {
      this.rooms.get(roomId)?.participants.delete(participantId);
    }
  }
}

function participantSummary(
  participant: InfinityParticipant,
): ParticipantSummary {
  const isWaiting =
    participant.isWaiting ||
    participant.serviceType === "waiting_room" ||
    participant.rawData?.service_type === "waiting_room";
  return {
    uuid: participant.uuid,
    isControlOnly: participant.protocol?.toLowerCase() === "api" && !isWaiting,
  };
}

function movableParticipantIds(
  participants: ReadonlyMap<ParticipantID, ParticipantSummary>,
): ParticipantID[] {
  return [...participants.values()]
    .filter((participant) => !participant.isControlOnly)
    .map(({ uuid }) => uuid);
}

function roomSummary(room: RoomRecord): RoomSummary {
  const participantIds = movableParticipantIds(room.participants);
  return {
    id: room.id,
    name: room.name ?? fallbackRoomName(room.id),
    participantIds,
    participantCount: room.hasParticipantSnapshot
      ? participantIds.length
      : null,
    occupancy:
      participantIds.length > 0
        ? "occupied"
        : room.hasParticipantSnapshot
          ? "empty"
          : "unknown",
  };
}

function fallbackRoomName(roomId: BreakoutRoomId): string {
  const suffix = String(roomId).replaceAll("-", "").slice(0, 8);
  return `Waiting room ${suffix || "unknown"}`;
}
