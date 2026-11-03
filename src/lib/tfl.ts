const API = "https://api.tfl.gov.uk";

// Official London Underground line colours.
export const LINE_COLOURS: Record<string, string> = {
  bakerloo: "#B36305",
  central: "#E32017",
  circle: "#FFD300",
  district: "#00782A",
  "hammersmith-city": "#F3A9BB",
  jubilee: "#A0A5A9",
  metropolitan: "#9B0056",
  northern: "#000000",
  piccadilly: "#003688",
  victoria: "#0098D4",
  "waterloo-city": "#95CDBA",
  elizabeth: "#6950A1",
  dlr: "#00A4A7",
  tram: "#84B817",
  liberty: "#646B70",
  lioness: "#FFC72C",
  mildmay: "#0072CE",
  suffragette: "#00843D",
  weaver: "#8A1538",
  windrush: "#E4002B",
};

export const OVERGROUND_LINE_IDS = [
  "liberty",
  "lioness",
  "mildmay",
  "suffragette",
  "weaver",
  "windrush",
] as const;

export type LineStatus = {
  id: string;
  name: string;
  lineStatuses: { statusSeverity: number; statusSeverityDescription: string; reason?: string }[];
};

export type Arrival = {
  id: string;
  lineId: string;
  lineName: string;
  platformName: string;
  towards: string;
  destinationName?: string;
  timeToStation: number;
};

export type JourneyLeg = {
  duration?: number;
  instruction?: { summary?: string; detailed?: string };
  mode?: { id?: string; name?: string };
  line?: { id?: string; name?: string };
  routeOptions?: { name?: string; lineIdentifier?: { id?: string } }[];
  departurePoint?: { commonName?: string; lat?: number; lon?: number };
  arrivalPoint?: { commonName?: string; lat?: number; lon?: number };
  path?: { lineString?: string };
  departureTime?: string;
  arrivalTime?: string;
  isDisrupted?: boolean;
  disruptions?: { description?: string; categoryDescription?: string }[];
};

export type Journey = {
  startDateTime?: string;
  arrivalDateTime?: string;
  duration: number;
  legs?: JourneyLeg[];
  fare?: { totalCost?: number };
};

export const JOURNEY_MODES = [
  { id: "tube", label: "Tube" },
  { id: "elizabeth-line", label: "Elizabeth line" },
  { id: "overground", label: "Overground" },
  { id: "dlr", label: "DLR" },
  { id: "tram", label: "Tram" },
  { id: "national-rail", label: "National Rail" },
  { id: "cable-car", label: "Cable car" },
] as const;

export type JourneyPreference = "LeastTime" | "LeastInterchange" | "LeastWalking";
export type AccessibilityPreference =
  "StepFreeToVehicle" | "StepFreeToPlatform" | "NoSolidStairs" | "NoEscalators" | "NoElevators";

export type JourneyOptions = {
  /** Local date and time as `YYYY-MM-DDTHH:mm`; empty means "now". */
  when?: string | undefined;
  timeIs?: "Departing" | "Arriving" | undefined;
  preference?: JourneyPreference | undefined;
  accessibility?: AccessibilityPreference | undefined;
  modes?: string[] | undefined;
  avoidLines?: string[] | undefined;
};

const DEFAULT_JOURNEY_MODES = [
  "tube",
  "dlr",
  "overground",
  "elizabeth-line",
  "tram",
  "cable-car",
  "national-rail",
];

export function buildJourneyUrl(from: string, to: string, options: JourneyOptions = {}) {
  const query = new URLSearchParams({
    mode: (options.modes?.length ? options.modes : DEFAULT_JOURNEY_MODES).join(","),
  });
  const when = options.when?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (when) {
    query.set("date", `${when[1]}${when[2]}${when[3]}`);
    query.set("time", `${when[4]}${when[5]}`);
    query.set("timeIs", options.timeIs ?? "Departing");
  }
  if (options.preference) query.set("journeyPreference", options.preference);
  if (options.accessibility) query.set("accessibilityPreference", options.accessibility);
  return `${API}/Journey/JourneyResults/${encodeURIComponent(from)}/to/${encodeURIComponent(to)}?${query}`;
}

type DisambiguationOption = { parameterValue?: string; matchQuality?: number };
type JourneyResponse = {
  journeys?: Journey[];
  fromLocationDisambiguation?: { disambiguationOptions?: DisambiguationOption[] };
  toLocationDisambiguation?: { disambiguationOptions?: DisambiguationOption[] };
};

function bestMatch(options?: DisambiguationOption[]) {
  return [...(options ?? [])].sort((a, b) => (b.matchQuality ?? 0) - (a.matchQuality ?? 0))[0]
    ?.parameterValue;
}

export function filterJourneysByAvoidedLines(journeys: Journey[], avoidLines: string[] = []) {
  if (avoidLines.length === 0) return journeys;
  return journeys.filter(
    (journey) => !journey.legs?.some((leg) => leg.line?.id && avoidLines.includes(leg.line.id)),
  );
}

export function formatFare(pence?: number) {
  return typeof pence === "number" ? `£${(pence / 100).toFixed(2)}` : null;
}

export async function fetchJourneys(
  from: string,
  to: string,
  options: JourneyOptions = {},
  labels: { from?: string; to?: string } = {},
): Promise<Journey[]> {
  let response = await fetch(buildJourneyUrl(from, to, options));
  // Some station IDs (e.g. certain 9400ZZ rail stops) are unknown to the planner; retry by name.
  if (response.status === 404 && (labels.from || labels.to)) {
    const retryFrom = labels.from || from;
    const retryTo = labels.to || to;
    if (retryFrom !== from || retryTo !== to) {
      from = retryFrom;
      to = retryTo;
      response = await fetch(buildJourneyUrl(from, to, options));
    }
  }
  // Free-text places (postcodes, addresses) can come back as an ambiguous match.
  if (response.status === 300) {
    const ambiguous: JourneyResponse = await response.json();
    const resolvedFrom = bestMatch(ambiguous.fromLocationDisambiguation?.disambiguationOptions);
    const resolvedTo = bestMatch(ambiguous.toLocationDisambiguation?.disambiguationOptions);
    response = await fetch(buildJourneyUrl(resolvedFrom ?? from, resolvedTo ?? to, options));
  }
  if (!response.ok) throw new Error(`Journey planner unavailable (${response.status})`);
  const result: JourneyResponse = await response.json();
  return filterJourneysByAvoidedLines(result.journeys ?? [], options.avoidLines);
}

export type StationCrowding = { percentageOfBaseline: number; timeUtc?: string | undefined };

export async function fetchStationCrowding(naptanId: string): Promise<StationCrowding | null> {
  const response = await fetch(`${API}/crowding/${encodeURIComponent(naptanId)}/Live`);
  if (!response.ok) return null;
  const data: { dataAvailable?: boolean; percentageOfBaseline?: number; timeUtc?: string } =
    await response.json();
  if (!data.dataAvailable || typeof data.percentageOfBaseline !== "number") return null;
  return { percentageOfBaseline: data.percentageOfBaseline, timeUtc: data.timeUtc };
}

export function crowdingLabel(percentageOfBaseline: number) {
  if (percentageOfBaseline < 0.4) return { label: "Quiet", tone: "good" as const };
  if (percentageOfBaseline < 0.7) return { label: "Moderately busy", tone: "warn" as const };
  return { label: "Very busy", tone: "bad" as const };
}

export type LineDisruption = {
  lineId: string;
  lineName: string;
  status: string;
  reason?: string | undefined;
  severity: number;
};

export function disruptionsFromStatus(lines: LineStatus[]): LineDisruption[] {
  return lines.flatMap((line) => {
    const status = line.lineStatuses.find((s) => s.statusSeverity !== 10);
    return status
      ? [
          {
            lineId: line.id,
            lineName: line.name,
            status: status.statusSeverityDescription,
            reason: status.reason,
            severity: status.statusSeverity,
          },
        ]
      : [];
  });
}

export function nextWeekendRange(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  start.setDate(start.getDate() + (day === 0 ? 0 : 6 - day));
  const end = new Date(start);
  if (day !== 0) end.setDate(end.getDate() + 1);
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { from: iso(start), to: iso(end) };
}

export async function fetchPlannedDisruptions(from: string, to: string): Promise<LineStatus[]> {
  const response = await fetch(
    `${API}/Line/Mode/tube,elizabeth-line,dlr,overground/Status/${from}/to/${to}`,
  );
  if (!response.ok) throw new Error(`Planned closures unavailable (${response.status})`);
  const lines: LineStatus[] = await response.json();
  return lines.filter((line) => line.lineStatuses.some((s) => s.statusSeverity !== 10));
}

export function distanceMetres(aLat: number, aLon: number, bLat: number, bLon: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export function nearestStations(
  stations: Station[],
  lat: number,
  lon: number,
  count = 5,
): (Station & { distance: number })[] {
  return stations
    .map((station) => ({
      ...station,
      distance: distanceMetres(lat, lon, station.lat, station.lon),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

export async function fetchLineStatus(): Promise<LineStatus[]> {
  const [tubeResponse, elizabethResponse, dlrResponse, tramResponse, overgroundResponse] =
    await Promise.all([
      fetch(`${API}/Line/Mode/tube/Status`),
      fetch(`${API}/Line/elizabeth/Status`),
      fetch(`${API}/Line/Mode/dlr/Status`),
      fetch(`${API}/Line/Mode/tram/Status`),
      fetch(`${API}/Line/Mode/overground/Status`),
    ]);
  if (!tubeResponse.ok) throw new Error(`Tube status feed unavailable (${tubeResponse.status})`);
  if (!elizabethResponse.ok) {
    throw new Error(`Elizabeth line status feed unavailable (${elizabethResponse.status})`);
  }
  if (!dlrResponse.ok) throw new Error(`DLR status feed unavailable (${dlrResponse.status})`);
  if (!tramResponse.ok) throw new Error(`Tram status feed unavailable (${tramResponse.status})`);
  if (!overgroundResponse.ok) {
    throw new Error(`Overground status feed unavailable (${overgroundResponse.status})`);
  }

  const [tubeLines, elizabethLine, dlrLines, tramLines, overgroundLines] = await Promise.all([
    tubeResponse.json() as Promise<LineStatus[]>,
    elizabethResponse.json() as Promise<LineStatus[]>,
    dlrResponse.json() as Promise<LineStatus[]>,
    tramResponse.json() as Promise<LineStatus[]>,
    overgroundResponse.json() as Promise<LineStatus[]>,
  ]);
  return [...tubeLines, ...elizabethLine, ...dlrLines, ...tramLines, ...overgroundLines];
}

export async function fetchArrivals(stopId: string): Promise<Arrival[]> {
  const r = await fetch(`${API}/StopPoint/${stopId}/Arrivals`);
  if (!r.ok) throw new Error(`Arrivals feed unavailable (${r.status})`);
  const data: Arrival[] = await r.json();
  return data.sort((a, b) => a.timeToStation - b.timeToStation);
}

export async function fetchStationArrivals(stopIds: string[]): Promise<Arrival[]> {
  const results = await Promise.allSettled(stopIds.map((stopId) => fetchArrivals(stopId)));
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<Arrival[]> => result.status === "fulfilled",
  );
  if (fulfilled.length === 0) throw new Error("Arrivals feed unavailable");
  const seen = new Set<string>();
  return fulfilled
    .flatMap((result) => result.value)
    .filter((arrival) => !seen.has(arrival.id) && seen.add(arrival.id))
    .sort((a, b) => a.timeToStation - b.timeToStation);
}

export const STATIONS = [
  { id: "910GPADTON", name: "Paddington (Elizabeth line)" },
  { id: "910GBONDST", name: "Bond Street (Elizabeth line)" },
  { id: "910GTOTCTRD", name: "Tottenham Court Road (Elizabeth line)" },
  { id: "910GLIVSTLL", name: "Liverpool Street (Elizabeth line)" },
  { id: "910GCANWHRF", name: "Canary Wharf (Elizabeth line)" },
  { id: "910GABWDXR", name: "Abbey Wood (Elizabeth line)" },
  { id: "940GZZLUOXC", name: "Oxford Circus" },
  { id: "940GZZLUKSX", name: "King's Cross St. Pancras" },
  { id: "940GZZLUBNK", name: "Bank" },
  { id: "940GZZLUWLO", name: "Waterloo" },
  { id: "940GZZLULVT", name: "Liverpool Street" },
  { id: "940GZZLULNB", name: "London Bridge" },
  { id: "940GZZLUVIC", name: "Victoria" },
  { id: "940GZZLUBST", name: "Baker Street" },
  { id: "940GZZLUCYF", name: "Canary Wharf" },
  { id: "940GZZLUCTN", name: "Camden Town" },
];

export function minutes(sec: number) {
  const m = Math.floor(sec / 60);
  return m <= 0 ? "Due" : `${m} min`;
}

export const TUBE_LINES = [
  "bakerloo",
  "central",
  "circle",
  "district",
  "hammersmith-city",
  "jubilee",
  "metropolitan",
  "northern",
  "piccadilly",
  "victoria",
  "waterloo-city",
];
const BOARD_LINES = Object.keys(LINE_COLOURS);

export type Station = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lines: string[];
  stopIds: string[];
};

export type StationAccessibilityItem = { label: string; value: string };

export async function fetchStationAccessibility(
  stopId: string,
): Promise<StationAccessibilityItem[]> {
  const response = await fetch(`${API}/StopPoint/${encodeURIComponent(stopId)}`);
  if (!response.ok) {
    throw new Error(`Station information unavailable (${response.status})`);
  }
  const stopPoint: {
    accessibilitySummary?: string;
    additionalProperties?: { key?: string; value?: string }[];
  } = await response.json();
  const items: StationAccessibilityItem[] = [];
  const seenKeys = new Set<string>();
  if (stopPoint.accessibilitySummary?.trim()) {
    items.push({ label: "Accessibility summary", value: stopPoint.accessibilitySummary.trim() });
  }
  for (const property of stopPoint.additionalProperties ?? []) {
    const key = property.key?.trim();
    const value = property.value?.trim();
    if (!key || !value || !/access|step.?free|lift|wheelchair|toilet|ramp|assistance/i.test(key)) {
      continue;
    }
    const normalizedKey = key.toLowerCase();
    if (seenKeys.has(normalizedKey)) continue;
    seenKeys.add(normalizedKey);
    items.push({
      label: key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
      value,
    });
  }
  return items;
}

export function cleanName(n: string) {
  return n
    .replace(/ (?:Underground|Rail) Station$/, "")
    .replace(/ Station$/, "")
    .replace(/ \(.*?\)$/, "")
    .trim();
}

export async function fetchAllStations(): Promise<Station[]> {
  const all = await Promise.all(
    BOARD_LINES.map(async (line) => {
      const r = await fetch(`${API}/Line/${line}/StopPoints`);
      if (!r.ok)
        return [] as {
          naptanId: string;
          commonName: string;
          lat: number;
          lon: number;
          line: string;
        }[];
      const d: { naptanId: string; commonName: string; lat: number; lon: number }[] =
        await r.json();
      return d.map((s) => ({ ...s, line }));
    }),
  );
  const map = new Map<string, Station>();
  for (const s of all.flat()) {
    const ex = map.get(s.naptanId);
    if (ex) {
      if (!ex.lines.includes(s.line)) ex.lines.push(s.line);
    } else
      map.set(s.naptanId, {
        id: s.naptanId,
        name: cleanName(s.commonName),
        lat: s.lat,
        lon: s.lon,
        lines: [s.line],
        stopIds: [s.naptanId],
      });
  }
  // Merge stations that share a cleaned name across different naptanIds
  // (e.g. tube "Bond Street" and Elizabeth line "Bond Street")
  const byName = new Map<string, Station>();
  for (const s of map.values()) {
    const ex = byName.get(s.name);
    if (ex) {
      for (const line of s.lines) {
        if (!ex.lines.includes(line)) ex.lines.push(line);
      }
      for (const stopId of s.stopIds) {
        if (!ex.stopIds.includes(stopId)) ex.stopIds.push(stopId);
      }
    } else {
      byName.set(s.name, { ...s, lines: [...s.lines], stopIds: [...s.stopIds] });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchLineGeometry(line: string): Promise<number[][][]> {
  const r = await fetch(`${API}/Line/${line}/Route/Sequence/outbound`);
  if (!r.ok) return [];
  const d: { lineStrings: string[] } = await r.json();
  return d.lineStrings.flatMap((s) => JSON.parse(s) as number[][][]);
}

export type LineArrival = Arrival & {
  vehicleId: string;
  naptanId: string;
  stationName: string;
  destinationNaptanId?: string;
  expectedArrival?: string;
  direction?: string;
  currentLocation?: string;
};

export async function fetchLineArrivals(): Promise<LineArrival[]> {
  const lineIds = ["dlr", "tram"];
  const responses = await Promise.all(
    lineIds.map((lineId) => fetch(`${API}/Line/${lineId}/Arrivals`)),
  );
  for (const [index, response] of responses.entries()) {
    if (!response.ok) {
      throw new Error(`${lineIds[index]} arrivals feed unavailable (${response.status})`);
    }
  }
  const arrivals = await Promise.all(
    responses.map((response) => response.json() as Promise<LineArrival[]>),
  );
  return arrivals.flat().sort((a, b) => a.timeToStation - b.timeToStation);
}

export async function fetchOvergroundArrivals(): Promise<LineArrival[]> {
  const responses = await Promise.all(
    OVERGROUND_LINE_IDS.map((lineId) => fetch(`${API}/Line/${lineId}/Arrivals`)),
  );
  for (const [index, response] of responses.entries()) {
    if (!response.ok) {
      throw new Error(
        `${OVERGROUND_LINE_IDS[index]} arrivals feed unavailable (${response.status})`,
      );
    }
  }
  const arrivals = await Promise.all(
    responses.map((response) => response.json() as Promise<LineArrival[]>),
  );
  return arrivals.flat().sort((a, b) => a.timeToStation - b.timeToStation);
}
