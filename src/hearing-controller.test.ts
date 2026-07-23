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
  id = roomId,
  name = "Case A",
  participantIds: ParticipantID[] = [participantOne, participantTwo],
  occupancy: RoomSummary["occupancy"] = "occupied",
  participantCount: number | null = participantIds.length,
): RoomSummary {
  return { id, name, participantIds, occupancy, participantCount };
}

describe("HearingController", () => {
  it("uses the roster count but asks Pexip to move everyone", async () => {
    const moveParticipants =
      vi.fn<(request: MoveParticipantsRequest) => Promise<unknown>>();
    moveParticipants.mockResolvedValue(undefined);
    const controller = new HearingController({ moveParticipants });

    await expect(controller.start(room())).resolves.toEqual({
      roomName: "Case A",
      participantCount: 2,
    });
    expect(moveParticipants).toHaveBeenCalledOnce();
    expect(moveParticipants).toHaveBeenCalledWith({
      fromBreakoutUuid: roomId,
      toRoomUuid: "main",
      participants: [],
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

  it("refuses rooms confirmed to be empty", async () => {
    const moveParticipants = vi.fn().mockResolvedValue(undefined);
    const controller = new HearingController({ moveParticipants });

    await expect(
      controller.startAll([room(roomId, "Observer only", [], "empty", 0)]),
    ).rejects.toBeInstanceOf(EmptyRoomError);
    expect(moveParticipants).not.toHaveBeenCalled();
  });

  it("starts a room with no snapshot even when its count is unavailable", async () => {
    const moveParticipants = vi.fn().mockResolvedValue(undefined);
    const controller = new HearingController({ moveParticipants });

    await expect(
      controller.start(room(roomId, "Case A", [], "unknown", null)),
    ).resolves.toEqual({
      roomName: "Case A",
      participantCount: null,
    });
    expect(moveParticipants).toHaveBeenCalledWith({
      fromBreakoutUuid: roomId,
      toRoomUuid: "main",
      participants: [],
    });
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
    await controller.start(
      room("room-case-b" as Exclude<RoomID, "main">, "Case B"),
    );
    expect(moveParticipants).toHaveBeenCalledTimes(2);
  });

  it("starts occupied and unknown rooms but excludes confirmed-empty rooms", async () => {
    const moveParticipants = vi.fn().mockResolvedValue(undefined);
    const controller = new HearingController({ moveParticipants });
    const secondRoomId = "room-case-b" as Exclude<RoomID, "main">;

    await expect(
      controller.startAll([
        room(roomId, "Case A", [participantOne]),
        room(
          "room-observer-only" as Exclude<RoomID, "main">,
          "Observer only",
          [],
          "empty",
          0,
        ),
        room(secondRoomId, "Case B", [participantTwo]),
      ]),
    ).resolves.toEqual({
      roomName: "Case A, Case B",
      participantCount: 2,
    });
    expect(moveParticipants).toHaveBeenCalledTimes(2);
    expect(moveParticipants).toHaveBeenNthCalledWith(2, {
      fromBreakoutUuid: secondRoomId,
      toRoomUuid: "main",
      participants: [],
    });
  });
});
