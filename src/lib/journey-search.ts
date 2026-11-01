import type { AccessibilityPreference, JourneyOptions, JourneyPreference } from "@/lib/tfl";

export type JourneySearch = {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  options: JourneyOptions;
};

export type JourneyUrlParams = {
  from?: string | undefined;
  to?: string | undefined;
  fromName?: string | undefined;
  toName?: string | undefined;
  when?: string | undefined;
  timeIs?: "Departing" | "Arriving" | undefined;
  pref?: JourneyPreference | undefined;
  acc?: AccessibilityPreference | undefined;
  modes?: string | undefined;
  avoid?: string | undefined;
};

const PREFERENCES = ["LeastTime", "LeastInterchange", "LeastWalking"];
const ACCESSIBILITY = [
  "StepFreeToVehicle",
  "StepFreeToPlatform",
  "NoSolidStairs",
  "NoEscalators",
  "NoElevators",
];

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : undefined;

export function validateJourneyParams(search: Record<string, unknown>): JourneyUrlParams {
  const pref = text(search["pref"]);
  const acc = text(search["acc"]);
  const timeIs = text(search["timeIs"]);
  return {
    from: text(search["from"]),
    to: text(search["to"]),
    fromName: text(search["fromName"]),
    toName: text(search["toName"]),
    when: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text(search["when"]) ?? "")
      ? text(search["when"])
      : undefined,
    timeIs: timeIs === "Arriving" || timeIs === "Departing" ? timeIs : undefined,
    pref: pref && PREFERENCES.includes(pref) ? (pref as JourneyPreference) : undefined,
    acc: acc && ACCESSIBILITY.includes(acc) ? (acc as AccessibilityPreference) : undefined,
    modes: text(search["modes"]),
    avoid: text(search["avoid"]),
  };
}

const list = (value?: string) => (value ? value.split(",").filter(Boolean) : []);

export function journeyFromParams(params: JourneyUrlParams): JourneySearch | null {
  if (!params.from || !params.to) return null;
  return {
    from: params.from,
    to: params.to,
    fromLabel: params.fromName ?? params.from,
    toLabel: params.toName ?? params.to,
    options: {
      when: params.when,
      timeIs: params.timeIs,
      preference: params.pref,
      accessibility: params.acc,
      modes: list(params.modes),
      avoidLines: list(params.avoid),
    },
  };
}

export function journeyToParams(search: JourneySearch): JourneyUrlParams {
  const { options } = search;
  return {
    from: search.from,
    to: search.to,
    fromName: search.fromLabel,
    toName: search.toLabel,
    when: options.when || undefined,
    timeIs: options.when ? options.timeIs : undefined,
    pref: options.preference,
    acc: options.accessibility,
    modes: options.modes?.length ? options.modes.join(",") : undefined,
    avoid: options.avoidLines?.length ? options.avoidLines.join(",") : undefined,
  };
}
