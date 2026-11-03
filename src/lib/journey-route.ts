import { LINE_COLOURS, type Journey } from "@/lib/tfl";

export type JourneyRouteSegment = {
  coordinates: [number, number][];
  colour: string;
  walking: boolean;
};

export type JourneyRoute = {
  segments: JourneyRouteSegment[];
  stops: { coordinates: [number, number]; name: string }[];
};

const STORAGE_KEY = "tfl-live:journey-route";

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

export function buildJourneyRoute(journey: Journey): JourneyRoute {
  const segments: JourneyRouteSegment[] = [];
  const stops: JourneyRoute["stops"] = [];
  const addStop = (
    point: { commonName?: string; lat?: number; lon?: number } | undefined,
  ): void => {
    if (!point || typeof point.lat !== "number" || typeof point.lon !== "number") return;
    stops.push({ coordinates: [point.lon, point.lat], name: point.commonName ?? "" });
  };

  for (const leg of journey.legs ?? []) {
    const walking = leg.mode?.id === "walking" || !leg.line?.id;
    let coordinates = parseLineString(leg.path?.lineString);
    if (coordinates.length < 2 && leg.departurePoint && leg.arrivalPoint) {
      const { departurePoint: a, arrivalPoint: b } = leg;
      if (
        typeof a.lat === "number" &&
        typeof a.lon === "number" &&
        typeof b.lat === "number" &&
        typeof b.lon === "number"
      ) {
        coordinates = [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ];
      }
    }
    if (coordinates.length >= 2) {
      segments.push({
        coordinates,
        colour: (leg.line?.id && LINE_COLOURS[leg.line.id]) || "#2563eb",
        walking,
      });
    }
    addStop(leg.departurePoint);
  }
  addStop(journey.legs?.[journey.legs.length - 1]?.arrivalPoint);
  return { segments, stops };
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
    return Array.isArray(route.segments) && route.segments.length > 0 ? route : null;
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
