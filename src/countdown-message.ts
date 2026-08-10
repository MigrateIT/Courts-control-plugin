import { PLUGIN_ID } from "./constants";

const countdownProtocolVersion = 1;
const countdownStarted = "hearing-countdown-started";
const countdownCancelled = "hearing-countdown-cancelled";

export type CountdownMessage =
  | {
      readonly type: typeof countdownStarted;
      readonly operationId: string;
      readonly seconds: number;
    }
  | {
      readonly type: typeof countdownCancelled;
      readonly operationId: string;
    };

export function countdownStartedMessage(
  operationId: string,
  seconds: number,
): Record<string, unknown> {
  return {
    pluginId: PLUGIN_ID,
    protocolVersion: countdownProtocolVersion,
    type: countdownStarted,
    operationId,
    seconds,
  };
}

export function countdownCancelledMessage(
  operationId: string,
): Record<string, unknown> {
  return {
    pluginId: PLUGIN_ID,
    protocolVersion: countdownProtocolVersion,
    type: countdownCancelled,
    operationId,
  };
}

export function parseCountdownMessage(
  payload: Readonly<Record<string, unknown>>,
): CountdownMessage | undefined {
  if (
    payload.pluginId !== PLUGIN_ID ||
    payload.protocolVersion !== countdownProtocolVersion ||
    typeof payload.operationId !== "string" ||
    payload.operationId.length === 0
  ) {
    return undefined;
  }

  if (
    payload.type === countdownStarted &&
    typeof payload.seconds === "number" &&
    Number.isInteger(payload.seconds) &&
    payload.seconds > 0
  ) {
    return {
      type: countdownStarted,
      operationId: payload.operationId,
      seconds: payload.seconds,
    };
  }

  if (payload.type === countdownCancelled) {
    return {
      type: countdownCancelled,
      operationId: payload.operationId,
    };
  }

  return undefined;
}
