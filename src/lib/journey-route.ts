import { LINE_COLOURS, type Journey } from "@/lib/tfl";

export type Bounds = [number, number, number, number];

export type JourneyRouteSegment = {
  coordinates: [number, number][];
  colour: string;
  walking: boolean;
  label: string;
  step: number;
};

export type JourneyRouteStop = {
  coordinates: [number, number];
  name: string;
  kind: "start" | "interchange" | "end";
  number?: number;
};

export type JourneyRouteStep = {
  instruction: string;
  from: string;
  to: string;
  minutes?: number;
  colour: string;
  walking: boolean;
  label: string;
  bounds?: Bounds;
  departureTime?: string;
};

export type JourneyRoute = {
  segments: JourneyRouteSegment[];
  stops: JourneyRouteStop[];
  steps: JourneyRouteStep[];
  duration: number;
};

const STORAGE_KEY = "tfl-live:journey-route";
const MODE_COLOURS: Record<string, string> = {
  bus: "#E32017",
  "national-rail": "#6b7280",
  overground: "#EE7C0E",
  "elizabeth-line": "#6950A1",
  "cable-car": "#E21836",
};

export function shortStationName(name?: string) {
  return (name ?? "")
    .replace(/\s*\((London|Central London)\)/i, "")
    .replace(/\s+(Underground|Rail|DLR|Tram|Overground)?\s*(Station|Stop)$/i, "")
    .trim();
}

function parseLineString(value?: string): [number, number][] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((pair) =>
      Array.isArray(pair) && typeof pair[0] === "number" && typeof pair[1] === "number"
        ? [[pair[1], pair[0]] as [number, number]]
        : [],
    );
  } catch {
    return [];
  }
}

function boundsOf(coordinates: [number, number][]): Bounds | undefined {
  if (coordinates.length === 0) return undefined;
  const lngs = coordinates.map((c) => c[0]);
  const lats = coordinates.map((c) => c[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

export function buildJourneyRoute(journey: Journey): JourneyRoute {
  const segments: JourneyRouteSegment[] = [];
  const stops: JourneyRouteStop[] = [];
  const steps: JourneyRouteStep[] = [];
  const legs = journey.legs ?? [];

  const addStop = (
    point: { commonName?: string; lat?: number; lon?: number } | undefined,
    kind: JourneyRouteStop["kind"],
    number?: number,
  ) => {
    if (!point || typeof point.lat !== "number" || typeof point.lon !== "number") return;
    const stop: JourneyRouteStop = {
      coordinates: [point.lon, point.lat],
      name: shortStationName(point.commonName),
      kind,
    };
    if (number !== undefined) stop.number = number;
    stops.push(stop);
  };

  for (const [index, leg] of legs.entries()) {
    const modeId = leg.mode?.id;
    const lineId =
      leg.line?.id ??
      leg.routeOptions?.find((o) => o.lineIdentifier?.id)?.lineIdentifier?.id ??
      modeId;
    const walking = modeId === "walking" || modeId === "cycle";
    let coordinates = parseLineString(leg.path?.lineString);
    const { departurePoint: a, arrivalPoint: b } = leg;
    if (
      coordinates.length < 2 &&
      typeof a?.lat === "number" &&
      typeof a.lon === "number" &&
      typeof b?.lat === "number" &&
      typeof b.lon === "number"
    ) {
      coordinates = [
        [a.lon, a.lat],
        [b.lon, b.lat],
      ];
    }
    const colour =
      modeId === "bus"
        ? MODE_COLOURS["bus"]!
        : (lineId && (LINE_COLOURS[lineId] ?? MODE_COLOURS[lineId])) || "#2563eb";
    const modeName = leg.mode?.name ?? "Travel";
    const lineName = leg.line?.name ?? leg.routeOptions?.[0]?.name;
    const label = walking ? "Walk" : (lineName ?? modeName);

    if (coordinates.length >= 2) {
      segments.push({ coordinates, colour, walking, label, step: index });
    }
    steps.push({
      instruction:
        leg.instruction?.summary ??
        (lineName
          ? `Take ${lineName}`
          : `${modeName} to ${shortStationName(b?.commonName) || "destination"}`),
      from: shortStationName(a?.commonName),
      to: shortStationName(b?.commonName),
      ...(leg.duration !== undefined ? { minutes: leg.duration } : {}),
      colour,
      walking,
      label,
      ...(leg.departureTime ? { departureTime: leg.departureTime } : {}),
      ...(boundsOf(coordinates) ? { bounds: boundsOf(coordinates) as Bounds } : {}),
    });
    addStop(a, index === 0 ? "start" : "interchange", index === 0 ? undefined : index);
  }
  addStop(legs[legs.length - 1]?.arrivalPoint, "end");
  return { segments, stops, steps, duration: journey.duration };
}

export function saveJourneyRoute(route: JourneyRoute) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(route));
  } catch {
    // Storage may be unavailable (private mode); the map simply opens without a route.
  }
}

export function loadJourneyRoute(): JourneyRoute | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const route = JSON.parse(raw) as JourneyRoute;
    const valid =
      Array.isArray(route.segments) &&
      route.segments.length > 0 &&
      Array.isArray(route.steps) &&
      route.steps.every((step) => typeof step.label === "string");
    return valid ? route : null;
  } catch {
    return null;
  }
}

export function clearJourneyRoute() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
