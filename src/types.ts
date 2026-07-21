import type { ParticipantID, RoomID } from "@pexip/plugin-api";

export type ParticipantSummary = {
  readonly uuid: ParticipantID;
  readonly isControlOnly: boolean;
};

export type RoomSummary = {
  readonly id: Exclude<RoomID, "main">;
  readonly name: string;
  readonly participantIds: readonly ParticipantID[];
};

export type StartedHearing = {
  readonly roomName: string;
  readonly participantCount: number;
};

export type MoveParticipantsRequest = {
  readonly fromBreakoutUuid?: Exclude<RoomID, "main">;
  readonly toRoomUuid: RoomID | "previous";
  readonly participants: ParticipantID[];
};
