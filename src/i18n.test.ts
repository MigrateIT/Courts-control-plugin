import { describe, expect, it } from "vitest";
import { resolveLocale, translate } from "./i18n";

describe("i18n", () => {
  it("selects Dutch language variants and otherwise falls back to English", () => {
    expect(resolveLocale("nl-NL")).toBe("nl");
    expect(resolveLocale("NL")).toBe("nl");
    expect(resolveLocale("de-DE")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("substitutes all message values", () => {
    expect(
      translate("en", "hearingStarted", { count: 2, room: "Case A" }),
    ).toBe("2 participant(s) admitted from Case A.");
    expect(translate("nl", "toolbarReturn")).toContain("vorige ruimte");
  });
});
