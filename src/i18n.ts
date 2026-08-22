export const translationKeys = [
  "toolbarStart",
  "toolbarReturn",
  "toolbarBusy",
  "selectTitle",
  "selectDescription",
  "selectRoom",
  "selectAll",
  "selectSubmit",
  "noWaitingRooms",
  "roomUnavailable",
  "hearingStarted",
  "hearingStartedCountUnknown",
  "hearingStartedAll",
  "hearingStartedAllCountUnknown",
  "hearingPaused",
  "actionBusy",
  "actionFailed",
  "roomFallback",
  "countUnavailable",
] as const;

export type Locale = "en" | "nl";
export type TranslationKey = (typeof translationKeys)[number];
export type TranslationCatalog = Readonly<Record<TranslationKey, string>>;
export type Localization = Readonly<{
  en: TranslationCatalog;
  nl: Partial<TranslationCatalog>;
}>;

export function resolveLocale(language: string | undefined): Locale {
  return language?.toLowerCase().startsWith("nl") ? "nl" : "en";
}

export function translate(
  localization: Localization,
  locale: Locale,
  key: TranslationKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  let message = localization[locale][key] ?? localization.en[key];
  for (const [name, value] of Object.entries(values)) {
    message = message.replaceAll(`{${name}}`, String(value));
  }
  return message;
}
