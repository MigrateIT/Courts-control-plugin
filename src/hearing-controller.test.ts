import type { ParticipantID, RoomID } from "@pexip/plugin-api";
import { describe, expect, it, vi } from "vitest";
import {
  EmptyRoomError,
  HearingActionInProgressError,
  HearingController,
} from "./hearing-controller";
import type { MoveParticipantsRequest, RoomSummary } from "./types";

const roomId = "room-case-a" as Exclude<RoomID, "main">;
const participantOne = "participant-1" as ParticipantID;
const participantTwo = "participant-2" as ParticipantID;

function room(
  participantIds: ParticipantID[] = [participantOne, participantTwo],
): RoomSummary {
  return { id: roomId, name: "Case A", participantIds };
}

describe("HearingController", () => {
  it("moves only the selected room participant snapshot into main", async () => {
    const moveParticipants =
      vi.fn<(request: MoveParticipantsRequest) => Promise<unknown>>();
    moveParticipants.mockResolvedValue(undefined);
    const controller = new HearingController({ moveParticipants });

    await expect(
      controller.start(room([participantOne, participantOne, participantTwo])),
    ).resolves.toEqual({ roomName: "Case A", participantCount: 2 });
    expect(moveParticipants).toHaveBeenCalledOnce();
    expect(moveParticipants).toHaveBeenCalledWith({
      fromBreakoutUuid: roomId,
      toRoomUuid: "main",
      participants: [participantOne, participantTwo],
    });
  });

  it("uses Pexip's native previous-room return without local state", async () => {
    const moveParticipants = vi.fn().mockResolvedValue(undefined);
    const controller = new HearingController({ moveParticipants });

    await expect(controller.pause()).resolves.toBeUndefined();
    expect(moveParticipants).toHaveBeenCalledWith({
      toRoomUuid: "previous",
      participants: [],
    });
  });

  it("refuses to start an empty room without calling Pexip", async () => {
    const moveParticipants = vi.fn().mockResolvedValue(undefined);
    const controller = new HearingController({ moveParticipants });

    await expect(controller.start(room([]))).rejects.toBeInstanceOf(
      EmptyRoomError,
    );
    expect(moveParticipants).not.toHaveBeenCalled();
  });

  it("serializes transitions and rejects a concurrent action", async () => {
    let finishMove: (() => void) | undefined;
    const moveParticipants = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishMove = resolve;
        }),
    );
    const controller = new HearingController({ moveParticipants });

    const starting = controller.start(room());
    expect(controller.isBusy()).toBe(true);
    await expect(controller.pause()).rejects.toBeInstanceOf(
      HearingActionInProgressError,
    );
    finishMove?.();
    await starting;
    expect(controller.isBusy()).toBe(false);
  });

  it("becomes available again when admission fails", async () => {
    const moveParticipants = vi
      .fn()
      .mockRejectedValue(new Error("Pexip rejected move"));
    const controller = new HearingController({ moveParticipants });

    await expect(controller.start(room())).rejects.toThrow(
      "Pexip rejected move",
    );
    expect(controller.isBusy()).toBe(false);
  });

  it("allows a native return retry after Pexip rejects it", async () => {
    const moveParticipants = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    const controller = new HearingController({ moveParticipants });

    await expect(controller.pause()).rejects.toThrow("temporary failure");
    await expect(controller.pause()).resolves.toBeUndefined();
    expect(moveParticipants).toHaveBeenCalledTimes(2);
  });

  it("does not retain hearing state between independent operations", async () => {
    const moveParticipants = vi.fn().mockResolvedValue(undefined);
    const controller = new HearingController({ moveParticipants });

    await controller.start(room());
    await controller.start(room(["other" as ParticipantID]));
    expect(moveParticipants).toHaveBeenCalledTimes(2);
  });
});
