const API = "https://api.tfl.gov.uk";

export type BusStop = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

export type BusArrival = {
  id: string;
  vehicleId: string;
  lineId: string;
  direction: string;
  naptanId: string;
  stationName: string;
  destinationName: string;
  timeToStation: number;
};

export type BusRoute = {
  stops: BusStop[];
  paths: [number, number][][];
};

export type BusLine = {
  id: string;
  name: string;
};

export type BusPosition = {
  vehicleId: string;
  direction: "inbound" | "outbound";
  coordinates: [number, number];
  nextStop: string;
  destination: string;
  timeToStation: number;
};

type TfLRouteSequence = {
  lineStrings?: string[];
  stopPointSequences?: { stopPoint?: BusStop[] }[];
};

function isBusLine(value: unknown): value is BusLine {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string"
  );
}

export async function fetchBusLines(): Promise<BusLine[]> {
  const response = await fetch(`${API}/Line/Mode/bus`);
  if (!response.ok) {
    throw new Error(`TfL bus route catalogue unavailable (${response.status})`);
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("TfL bus route catalogue returned an invalid response");
  }
  const lines = data.filter(isBusLine);
  return lines.sort((first, second) =>
    first.id.localeCompare(second.id, undefined, { numeric: true, sensitivity: "base" }),
  );
}

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function collectPaths(value: unknown, paths: [number, number][][]) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && value.every(isCoordinate)) {
    paths.push(value);
    return;
  }
  for (const child of value) collectPaths(child, paths);
}

export function parseBusRouteSequence(data: TfLRouteSequence): BusRoute {
  const stops = data.stopPointSequences?.[0]?.stopPoint?.filter(
    (stop) =>
      typeof stop.id === "string" &&
      typeof stop.name === "string" &&
      Number.isFinite(stop.lat) &&
      Number.isFinite(stop.lon),
  );
  const paths: [number, number][][] = [];

  for (const lineString of data.lineStrings ?? []) {
    try {
      collectPaths(JSON.parse(lineString) as unknown, paths);
    } catch (error) {
      console.error("Unable to parse TfL bus route geometry", error);
    }
  }

  if (!stops?.length) throw new Error("TfL did not return any stops for this bus route");
  if (!paths.length) throw new Error("TfL did not return route geometry for this bus route");
  return { stops, paths };
}

export async function fetchBusRoute(lineId: string, direction: "inbound" | "outbound") {
  const response = await fetch(
    `${API}/Line/${encodeURIComponent(lineId)}/Route/Sequence/${direction}`,
  );
  if (!response.ok) {
    throw new Error(`Bus ${lineId} route unavailable (${response.status})`);
  }
  return parseBusRouteSequence((await response.json()) as TfLRouteSequence);
}

export async function fetchBusArrivals(lineId: string): Promise<BusArrival[]> {
  const response = await fetch(`${API}/Line/${encodeURIComponent(lineId)}/Arrivals`);
  if (!response.ok) {
    throw new Error(`Bus ${lineId} live arrival feed unavailable (${response.status})`);
  }
  const arrivals = (await response.json()) as BusArrival[];
  return arrivals
    .filter(
      (arrival) => arrival.vehicleId && arrival.naptanId && Number.isFinite(arrival.timeToStation),
    )
    .sort((first, second) => first.timeToStation - second.timeToStation);
}

export function getBusPositions(
  arrivals: BusArrival[],
  stops: BusStop[],
  direction: "inbound" | "outbound",
  elapsedSeconds = 0,
): BusPosition[] {
  const stopIndex = new Map(stops.map((stop, index) => [stop.id, index]));
  const nearestArrivalByVehicle = new Map<string, BusArrival>();
  for (const arrival of arrivals) {
    if (arrival.direction.toLowerCase() !== direction || !stopIndex.has(arrival.naptanId)) continue;
    const existing = nearestArrivalByVehicle.get(arrival.vehicleId);
    if (!existing || arrival.timeToStation < existing.timeToStation) {
      nearestArrivalByVehicle.set(arrival.vehicleId, arrival);
    }
  }

  return [...nearestArrivalByVehicle.values()].flatMap((arrival) => {
    const index = stopIndex.get(arrival.naptanId);
    const nextStop = index === undefined ? undefined : stops[index];
    if (!nextStop || index === undefined) return [];

    const previousStop = index > 0 ? stops[index - 1] : undefined;
    let coordinates: [number, number] = [nextStop.lon, nextStop.lat];
    if (previousStop) {
      const distanceMeters = Math.hypot(
        (nextStop.lon - previousStop.lon) * 70_000,
        (nextStop.lat - previousStop.lat) * 111_000,
      );
      const segmentSeconds = Math.max(20, distanceMeters / 4.5);
      const progress = Math.max(
        0,
        Math.min(1, 1 - Math.max(0, arrival.timeToStation - elapsedSeconds) / segmentSeconds),
      );
      coordinates = [
        previousStop.lon + (nextStop.lon - previousStop.lon) * progress,
        previousStop.lat + (nextStop.lat - previousStop.lat) * progress,
      ];
    }

    return [
      {
        vehicleId: arrival.vehicleId,
        direction,
        coordinates,
        nextStop: arrival.stationName || nextStop.name,
        destination: arrival.destinationName,
        timeToStation: Math.max(0, arrival.timeToStation - elapsedSeconds),
      },
    ];
  });
}

export function snapBusPositionsToPaths(
  positions: BusPosition[],
  paths: [number, number][][],
): BusPosition[] {
  const metersPerDegree = 111_320;
  return positions.map((position) => {
    const [longitude, latitude] = position.coordinates;
    const longitudeScale = Math.cos((latitude * Math.PI) / 180);
    const pointX = longitude * metersPerDegree * longitudeScale;
    const pointY = latitude * metersPerDegree;
    let closestPoint: [number, number] | undefined;
    let closestDistanceSquared = Number.POSITIVE_INFINITY;

    for (const path of paths) {
      for (let index = 1; index < path.length; index += 1) {
        const start = path[index - 1]!;
        const end = path[index]!;
        const startX = start[0] * metersPerDegree * longitudeScale;
        const startY = start[1] * metersPerDegree;
        const deltaX = (end[0] - start[0]) * metersPerDegree * longitudeScale;
        const deltaY = (end[1] - start[1]) * metersPerDegree;
        const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY;
        const progress =
          segmentLengthSquared === 0
            ? 0
            : Math.max(
                0,
                Math.min(
                  1,
                  ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / segmentLengthSquared,
                ),
              );
        const projectedX = startX + progress * deltaX;
        const projectedY = startY + progress * deltaY;
        const distanceSquared =
          (pointX - projectedX) * (pointX - projectedX) +
          (pointY - projectedY) * (pointY - projectedY);

        if (distanceSquared < closestDistanceSquared) {
          closestDistanceSquared = distanceSquared;
          closestPoint = [
            start[0] + progress * (end[0] - start[0]),
            start[1] + progress * (end[1] - start[1]),
          ];
        }
      }
    }

    return closestPoint ? { ...position, coordinates: closestPoint } : position;
  });
}
