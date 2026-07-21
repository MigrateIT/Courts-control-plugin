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
    this.assertAvailable();

    const participantIds = uniqueParticipantIds(room.participantIds);
    if (participantIds.length === 0) throw new EmptyRoomError();

    this.busy = true;
    try {
      await this.options.moveParticipants({
        fromBreakoutUuid: room.id,
        toRoomUuid: "main",
        participants: [...participantIds],
      });
      return {
        roomName: room.name,
        participantCount: participantIds.length,
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
