import { describe, expect, it } from "vitest";
import { PLUGIN_ID } from "./constants";
import {
  countdownCancelledMessage,
  countdownStartedMessage,
  parseCountdownMessage,
} from "./countdown-message";

describe("countdown messages", () => {
  it("creates and parses a countdown start", () => {
    const payload = countdownStartedMessage("operation-1", 10);

    expect(payload).toEqual({
      pluginId: PLUGIN_ID,
      protocolVersion: 1,
      type: "hearing-countdown-started",
      operationId: "operation-1",
      seconds: 10,
    });
    expect(parseCountdownMessage(payload)).toEqual({
      type: "hearing-countdown-started",
      operationId: "operation-1",
      seconds: 10,
    });
  });

  it("creates and parses a countdown cancellation", () => {
    const payload = countdownCancelledMessage("operation-1");

    expect(parseCountdownMessage(payload)).toEqual({
      type: "hearing-countdown-cancelled",
      operationId: "operation-1",
    });
  });

  it.each([
    {},
    countdownStartedMessage("", 10),
    countdownStartedMessage("operation-1", 0),
    countdownStartedMessage("operation-1", 1.5),
    { ...countdownStartedMessage("operation-1", 10), pluginId: "other" },
    { ...countdownStartedMessage("operation-1", 10), protocolVersion: 2 },
    { ...countdownStartedMessage("operation-1", 10), type: "other" },
  ])("ignores unrelated or malformed payloads", (payload) => {
    expect(parseCountdownMessage(payload)).toBeUndefined();
  });
});
