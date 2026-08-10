import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseConfiguration } from "./configuration";
import { resolveLocale, translate } from "./i18n";

const configuration = parseConfiguration(
  JSON.parse(
    readFileSync(
      new URL("../public/assets/configuration.json", import.meta.url),
      "utf8",
    ),
  ),
);

describe("i18n", () => {
  it("selects Dutch language variants and otherwise falls back to English", () => {
    expect(resolveLocale("nl-NL")).toBe("nl");
    expect(resolveLocale("NL")).toBe("nl");
    expect(resolveLocale("de-DE")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("loads external messages and substitutes all values", () => {
    const { localization } = configuration;
    expect(
      translate(localization, "en", "hearingStarted", {
        count: 2,
        room: "Case A",
      }),
    ).toBe("2 participant(s) admitted from Case A.");
    expect(translate(localization, "nl", "toolbarReturn")).toContain(
      "vorige ruimte",
    );
    expect(translate(localization, "nl", "selectAll")).toBe(
      "Alle wachtruimten tegelijk toelaten",
    );
    expect(translate(localization, "nl", "selectTitle")).toBe(
      "Online zitting starten",
    );
    expect(
      translate(localization, "en", "hearingCountdown", { seconds: 10 }),
    ).toBe("Hearing starts in 10 second(s)…");
    expect(
      translate(localization, "nl", "hearingPauseCountdown", { seconds: 10 }),
    ).toBe("Deelnemers keren over 10 seconde(n) terug naar wachtruimte…");
    expect(translate(localization, "en", "countUnavailable")).toBe(
      "count unavailable",
    );
    expect(
      translate(localization, "nl", "hearingStartedCountUnknown", {
        room: "Zaak A",
      }),
    ).toBe("Deelnemers toegelaten uit Zaak A.");
  });

  it("falls back to English when an optional Dutch key is absent", () => {
    const localization = {
      ...configuration.localization,
      nl: { ...configuration.localization.nl, actionBusy: undefined },
    };

    expect(translate(localization, "nl", "actionBusy")).toBe(
      configuration.localization.en.actionBusy,
    );
  });
});
