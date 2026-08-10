import { describe, expect, it } from "vitest";
import { PLUGIN_ID } from "./constants";
import {
  countdownCancelledMessage,
  countdownStartedMessage,
  hearingPausedMessage,
  hearingStartedMessage,
  parseHostApplicationMessage,
} from "./application-message";

describe("host application messages", () => {
  it("creates and parses countdown messages", () => {
    const started = countdownStartedMessage("operation-1", 10, "pause");

    expect(started).toEqual({
      pluginId: PLUGIN_ID,
      protocolVersion: 1,
      type: "hearing-countdown-started",
      operationId: "operation-1",
      seconds: 10,
      action: "pause",
    });
    expect(parseHostApplicationMessage(started)).toMatchObject({
      type: "hearing-countdown-started",
      operationId: "operation-1",
      seconds: 10,
      action: "pause",
    });
    expect(
      parseHostApplicationMessage(countdownCancelledMessage("operation-1")),
    ).toEqual({
      type: "hearing-countdown-cancelled",
      operationId: "operation-1",
    });
  });

  it("treats countdowns from the preceding release as Start", () => {
    expect(
      parseHostApplicationMessage({
        pluginId: PLUGIN_ID,
        protocolVersion: 1,
        type: "hearing-countdown-started",
        operationId: "operation-1",
        seconds: 10,
      }),
    ).toMatchObject({ action: "start" });
  });

  it("creates and parses hearing success messages", () => {
    const started = hearingStartedMessage("operation-2", {
      allRooms: false,
      participantCount: 2,
      roomName: "Case A",
    });

    expect(parseHostApplicationMessage(started)).toEqual({
      type: "hearing-started",
      operationId: "operation-2",
      allRooms: false,
      participantCount: 2,
      roomName: "Case A",
    });
    expect(
      parseHostApplicationMessage(hearingPausedMessage("operation-3")),
    ).toEqual({
      type: "hearing-paused",
      operationId: "operation-3",
    });
  });

  it("accepts an unavailable participant count", () => {
    expect(
      parseHostApplicationMessage(
        hearingStartedMessage("operation-2", {
          allRooms: true,
          participantCount: null,
          roomName: "Case A, Case B",
        }),
      ),
    ).toMatchObject({
      type: "hearing-started",
      allRooms: true,
      participantCount: null,
    });
  });

  it.each([
    {},
    countdownStartedMessage("", 10, "start"),
    countdownStartedMessage("operation-1", 0, "start"),
    countdownStartedMessage("operation-1", 1.5, "start"),
    {
      ...countdownStartedMessage("operation-1", 10, "start"),
      pluginId: "other",
    },
    {
      ...countdownStartedMessage("operation-1", 10, "start"),
      protocolVersion: 2,
    },
    {
      ...countdownStartedMessage("operation-1", 10, "start"),
      type: "other",
    },
    {
      ...countdownStartedMessage("operation-1", 10, "start"),
      action: "other",
    },
    {
      ...hearingStartedMessage("operation-2", {
        allRooms: false,
        participantCount: 2,
        roomName: "Case A",
      }),
      allRooms: "false",
    },
    {
      ...hearingStartedMessage("operation-2", {
        allRooms: false,
        participantCount: 2,
        roomName: "Case A",
      }),
      participantCount: -1,
    },
    {
      ...hearingStartedMessage("operation-2", {
        allRooms: false,
        participantCount: 2,
        roomName: "Case A",
      }),
      roomName: "",
    },
  ])("ignores unrelated or malformed payloads", (payload) => {
    expect(parseHostApplicationMessage(payload)).toBeUndefined();
  });
});
