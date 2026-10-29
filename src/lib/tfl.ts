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

export const TUBE_LINES = Object.keys(LINE_COLOURS).filter(
  (line) =>
    line !== "elizabeth" && !OVERGROUND_LINE_IDS.some((overgroundLine) => overgroundLine === line),
);
const BOARD_LINES = Object.keys(LINE_COLOURS);

export type Station = { id: string; name: string; lat: number; lon: number; lines: string[] };

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
    } else {
      byName.set(s.name, { ...s });
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
