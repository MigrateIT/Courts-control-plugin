import { PLUGIN_ID } from "./constants";

const protocolVersion = 1;
const countdownStarted = "hearing-countdown-started";
const countdownCancelled = "hearing-countdown-cancelled";
const hearingStarted = "hearing-started";
const hearingPaused = "hearing-paused";

export type HostApplicationMessage =
  | {
      readonly type: typeof countdownStarted;
      readonly operationId: string;
      readonly seconds: number;
    }
  | {
      readonly type: typeof countdownCancelled;
      readonly operationId: string;
    }
  | {
      readonly type: typeof hearingStarted;
      readonly operationId: string;
      readonly allRooms: boolean;
      readonly participantCount: number | null;
      readonly roomName: string;
    }
  | {
      readonly type: typeof hearingPaused;
      readonly operationId: string;
    };

export function countdownStartedMessage(
  operationId: string,
  seconds: number,
): Record<string, unknown> {
  return envelope(countdownStarted, operationId, { seconds });
}

export function countdownCancelledMessage(
  operationId: string,
): Record<string, unknown> {
  return envelope(countdownCancelled, operationId);
}

export function hearingStartedMessage(
  operationId: string,
  details: {
    readonly allRooms: boolean;
    readonly participantCount: number | null;
    readonly roomName: string;
  },
): Record<string, unknown> {
  return envelope(hearingStarted, operationId, details);
}

export function hearingPausedMessage(
  operationId: string,
): Record<string, unknown> {
  return envelope(hearingPaused, operationId);
}

export function parseHostApplicationMessage(
  payload: Readonly<Record<string, unknown>>,
): HostApplicationMessage | undefined {
  if (
    payload.pluginId !== PLUGIN_ID ||
    payload.protocolVersion !== protocolVersion ||
    typeof payload.operationId !== "string" ||
    payload.operationId.length === 0
  ) {
    return undefined;
  }

  if (
    payload.type === countdownStarted &&
    isNonNegativeInteger(payload.seconds) &&
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

  if (
    payload.type === hearingStarted &&
    typeof payload.allRooms === "boolean" &&
    (payload.participantCount === null ||
      isNonNegativeInteger(payload.participantCount)) &&
    typeof payload.roomName === "string" &&
    payload.roomName.length > 0
  ) {
    return {
      type: hearingStarted,
      operationId: payload.operationId,
      allRooms: payload.allRooms,
      participantCount: payload.participantCount,
      roomName: payload.roomName,
    };
  }

  if (payload.type === hearingPaused) {
    return {
      type: hearingPaused,
      operationId: payload.operationId,
    };
  }

  return undefined;
}

function envelope(
  type: HostApplicationMessage["type"],
  operationId: string,
  details: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    pluginId: PLUGIN_ID,
    protocolVersion,
    type,
    operationId,
    ...details,
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
