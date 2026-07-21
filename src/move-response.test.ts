import { describe, expect, it } from "vitest";
import {
  assertSuccessfulMoveResponse,
  HearingMoveRejectedError,
} from "./move-response";

describe("move response validation", () => {
  it("accepts both documented Pexip success response variants", () => {
    expect(() =>
      assertSuccessfulMoveResponse({ status: 200, data: {} }),
    ).not.toThrow();
    expect(() => assertSuccessfulMoveResponse(undefined)).not.toThrow();
  });

  it.each([null, {}, { status: 403 }, { status: "200" }])(
    "rejects an unconfirmed move response: %j",
    (response) => {
      expect(() => assertSuccessfulMoveResponse(response)).toThrow(
        HearingMoveRejectedError,
      );
    },
  );

  it("retains the Pexip status for diagnostics", () => {
    try {
      assertSuccessfulMoveResponse({ status: 403 });
      throw new Error("Expected move response validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HearingMoveRejectedError);
      expect((error as HearingMoveRejectedError).responseStatus).toBe(403);
    }
  });
});
