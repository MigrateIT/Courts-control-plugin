export type Locale = "en" | "nl";

const translations = {
  en: {
    toolbarStart: "Start a case hearing",
    toolbarReturn: "Pause hearing and return participants to previous rooms",
    toolbarBusy: "Updating the hearing…",
    selectTitle: "Start case hearing",
    selectDescription:
      "Choose one waiting room. Only the participants currently in that room will be admitted to the main hearing.",
    selectRoom: "Waiting room",
    selectSubmit: "Start hearing",
    noWaitingRooms: "No waiting room with participants is available.",
    roomUnavailable: "That waiting room is no longer available. Choose again.",
    hearingStarted: "{count} participant(s) admitted from {room}.",
    hearingPaused: "Participants were returned to their previous rooms.",
    actionBusy: "Please wait for the current hearing action to finish.",
    actionFailed:
      "The hearing could not be updated. No broader room action was attempted.",
    roomFallback: "Waiting room {suffix}",
  },
  nl: {
    toolbarStart: "Start een zaakzitting",
    toolbarReturn:
      "Pauzeer de zitting en zet deelnemers terug in hun vorige ruimte",
    toolbarBusy: "De zitting wordt bijgewerkt…",
    selectTitle: "Zaakzitting starten",
    selectDescription:
      "Kies één wachtruimte. Alleen de deelnemers die nu in die ruimte zitten, worden toegelaten tot de hoofdzitting.",
    selectRoom: "Wachtruimte",
    selectSubmit: "Zitting starten",
    noWaitingRooms: "Er is geen wachtruimte met deelnemers beschikbaar.",
    roomUnavailable: "Die wachtruimte is niet meer beschikbaar. Kies opnieuw.",
    hearingStarted: "{count} deelnemer(s) toegelaten uit {room}.",
    hearingPaused: "Deelnemers zijn teruggezet in hun vorige ruimte.",
    actionBusy: "Wacht tot de huidige zittingsactie is afgerond.",
    actionFailed:
      "De zitting kon niet worden bijgewerkt. Er is geen bredere ruimteactie uitgevoerd.",
    roomFallback: "Wachtruimte {suffix}",
  },
} as const;

export type TranslationKey = keyof (typeof translations)["en"];

export function resolveLocale(language: string | undefined): Locale {
  return language?.toLowerCase().startsWith("nl") ? "nl" : "en";
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  let message: string = translations[locale][key];
  for (const [name, value] of Object.entries(values)) {
    message = message.replaceAll(`{${name}}`, String(value));
  }
  return message;
}
