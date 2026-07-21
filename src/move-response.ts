export class HearingMoveRejectedError extends Error {
  constructor(readonly responseStatus?: number) {
    super(
      responseStatus === undefined
        ? "Pexip did not confirm the participant move"
        : `Pexip rejected the participant move with status ${responseStatus}`,
    );
    this.name = "HearingMoveRejectedError";
  }
}

export function assertSuccessfulMoveResponse(response: unknown): void {
  // Pexip's public plugin contract explicitly includes `undefined` for
  // Webapp3 versions whose successful endpoint does not return a body.
  if (response === undefined) return;
  if (!isRecord(response) || response.status !== 200) {
    throw new HearingMoveRejectedError(
      isRecord(response) && typeof response.status === "number"
        ? response.status
        : undefined,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
