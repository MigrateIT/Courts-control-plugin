import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadConfiguration, parseConfiguration } from "./configuration";

const rawConfiguration = JSON.parse(
  readFileSync(
    new URL("../public/assets/configuration.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("configuration", () => {
  it("parses the runtime configuration and accepts zero countdown seconds", () => {
    expect(parseConfiguration(rawConfiguration).countdownSeconds).toBe(10);
    expect(
      parseConfiguration({ ...rawConfiguration, countdownSeconds: 0 })
        .countdownSeconds,
    ).toBe(0);
  });

  it("loads configuration without using a cached response", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify(rawConfiguration), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      loadConfiguration("./assets/configuration.json", fetcher),
    ).resolves.toMatchObject({ countdownSeconds: 10 });
    expect(fetcher).toHaveBeenCalledWith("./assets/configuration.json", {
      cache: "no-store",
    });
  });

  it("reports an unsuccessful configuration response", async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));

    await expect(loadConfiguration("missing.json", fetcher)).rejects.toThrow(
      "configuration could not be loaded (404)",
    );
  });

  it.each([
    [null, "Configuration must be an object"],
    [{}, "countdownSeconds must be a non-negative integer"],
    [
      { ...rawConfiguration, countdownSeconds: -1 },
      "countdownSeconds must be a non-negative integer",
    ],
    [
      { ...rawConfiguration, countdownSeconds: 1.5 },
      "countdownSeconds must be a non-negative integer",
    ],
    [
      { ...rawConfiguration, localization: null },
      "localization must be an object",
    ],
    [
      {
        ...rawConfiguration,
        localization: {
          ...(rawConfiguration.localization as Record<string, unknown>),
          en: null,
        },
      },
      "localization.en must be an object",
    ],
    [
      {
        ...rawConfiguration,
        localization: {
          ...(rawConfiguration.localization as Record<string, unknown>),
          en: {
            ...(
              rawConfiguration.localization as Record<
                string,
                Record<string, unknown>
              >
            ).en,
            toolbarStart: null,
          },
        },
      },
      "localization.en.toolbarStart must be a string",
    ],
    [
      {
        ...rawConfiguration,
        localization: {
          ...(rawConfiguration.localization as Record<string, unknown>),
          nl: null,
        },
      },
      "localization.nl must be an object",
    ],
    [
      {
        ...rawConfiguration,
        localization: {
          ...(rawConfiguration.localization as Record<string, unknown>),
          nl: {
            ...(
              rawConfiguration.localization as Record<
                string,
                Record<string, unknown>
              >
            ).nl,
            toolbarStart: false,
          },
        },
      },
      "localization.nl.toolbarStart must be a string",
    ],
  ])("rejects invalid configuration %#", (value, message) => {
    expect(() => parseConfiguration(value)).toThrow(message);
  });
});
