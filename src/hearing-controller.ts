import type {
  MoveParticipantsRequest,
  RoomSummary,
  StartedHearing,
} from "./types";

export class HearingActionInProgressError extends Error {
  constructor() {
    super("A hearing action is already in progress");
    this.name = "HearingActionInProgressError";
  }
}

export class EmptyRoomError extends Error {
  constructor() {
    super("The selected waiting room has no participants");
    this.name = "EmptyRoomError";
  }
}

export type HearingControllerOptions = {
  readonly moveParticipants: (
    request: MoveParticipantsRequest,
  ) => Promise<unknown>;
};

export class HearingController {
  private busy = false;

  constructor(private readonly options: HearingControllerOptions) {}

  isBusy(): boolean {
    return this.busy;
  }

  async start(room: RoomSummary): Promise<StartedHearing> {
    return this.startRooms([room]);
  }

  async startAll(rooms: readonly RoomSummary[]): Promise<StartedHearing> {
    return this.startRooms(rooms);
  }

  private async startRooms(
    rooms: readonly RoomSummary[],
  ): Promise<StartedHearing> {
    this.assertAvailable();

    const roomMoves = rooms
      .map((room) => ({
        room,
        participantIds: uniqueParticipantIds(room.participantIds),
      }))
      .filter(({ participantIds }) => participantIds.length > 0);
    if (roomMoves.length === 0) throw new EmptyRoomError();

    this.busy = true;
    try {
      const results = await Promise.allSettled(
        roomMoves.map(({ room, participantIds }) =>
          this.options.moveParticipants({
            fromBreakoutUuid: room.id,
            toRoomUuid: "main",
            participants: [...participantIds],
          }),
        ),
      );
      const failedMove = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failedMove) throw failedMove.reason;
      return {
        roomName: roomMoves.map(({ room }) => room.name).join(", "),
        participantCount: roomMoves.reduce(
          (count, { participantIds }) => count + participantIds.length,
          0,
        ),
      };
    } finally {
      this.busy = false;
    }
  }

  async pause(): Promise<void> {
    this.assertAvailable();

    this.busy = true;
    try {
      await this.options.moveParticipants({
        toRoomUuid: "previous",
        participants: [],
      });
    } finally {
      this.busy = false;
    }
  }

  private assertAvailable(): void {
    if (this.busy) throw new HearingActionInProgressError();
  }
}

function uniqueParticipantIds<T>(ids: readonly T[]): T[] {
  return [...new Set(ids)];
}
