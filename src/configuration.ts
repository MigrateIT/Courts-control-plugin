import {
  translationKeys,
  type Localization,
  type TranslationCatalog,
  type TranslationKey,
} from "./i18n";

export type PluginConfiguration = Readonly<{
  countdownSeconds: number;
  localization: Localization;
}>;

export async function loadConfiguration(
  url: string | URL,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<PluginConfiguration> {
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `Court hearing configuration could not be loaded (${response.status})`,
    );
  }
  return parseConfiguration(await response.json());
}

export function parseConfiguration(value: unknown): PluginConfiguration {
  if (!isRecord(value)) throw new Error("Configuration must be an object");
  const countdownSeconds = value.countdownSeconds;
  if (
    typeof countdownSeconds !== "number" ||
    !Number.isSafeInteger(countdownSeconds) ||
    countdownSeconds < 0
  ) {
    throw new Error("countdownSeconds must be a non-negative integer");
  }

  if (!isRecord(value.localization)) {
    throw new Error("localization must be an object");
  }

  return {
    countdownSeconds,
    localization: {
      en: completeCatalog(value.localization.en, "en"),
      nl: partialCatalog(value.localization.nl, "nl"),
    },
  };
}

function completeCatalog(value: unknown, locale: string): TranslationCatalog {
  if (!isRecord(value)) {
    throw new Error(`localization.${locale} must be an object`);
  }
  const entries = translationKeys.map((key) => {
    const message = value[key];
    if (typeof message !== "string") {
      throw new Error(`localization.${locale}.${key} must be a string`);
    }
    return [key, message] as const;
  });
  return Object.fromEntries(entries) as unknown as TranslationCatalog;
}

function partialCatalog(
  value: unknown,
  locale: string,
): Partial<TranslationCatalog> {
  if (!isRecord(value)) {
    throw new Error(`localization.${locale} must be an object`);
  }
  const entries: [TranslationKey, string][] = [];
  for (const key of translationKeys) {
    const message = value[key];
    if (message === undefined) continue;
    if (typeof message !== "string") {
      throw new Error(`localization.${locale}.${key} must be a string`);
    }
    entries.push([key, message]);
  }
  return Object.fromEntries(entries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
