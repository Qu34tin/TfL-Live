const MAP_DATA_URL = "https://www.londonunderground.live";
const TRAIN_ACTIONS_URL = "https://api.londonunderground.live/get_actions_for_all_trains";

export type Coordinate = [number, number];

export type TubeStation = {
  id: string;
  name: string;
  coordinates: Coordinate;
};

export type StationMarkerGroup = {
  station: TubeStation;
  stationIds: string[];
};

function stationDistanceMeters(a: Coordinate, b: Coordinate): number {
  const latitude = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const x = (a[0] - b[0]) * Math.cos(latitude) * 111_320;
  const y = (a[1] - b[1]) * 111_320;
  return Math.hypot(x, y);
}

export function groupStationMarkers(stations: TubeStation[]): StationMarkerGroup[] {
  const groups: StationMarkerGroup[] = [];
  const groupByStationId = new Map<string, StationMarkerGroup>();

  for (const station of stations) {
    const existingIdGroup = groupByStationId.get(station.id);
    if (existingIdGroup) continue;

    const normalizedName = normalizeStationName(station.name);
    const group = groups.find(
      (candidate) =>
        normalizeStationName(candidate.station.name) === normalizedName &&
        stationDistanceMeters(candidate.station.coordinates, station.coordinates) <= 100,
    );

    if (group) {
      group.stationIds.push(station.id);
      groupByStationId.set(station.id, group);
    } else {
      const newGroup = { station, stationIds: [station.id] };
      groups.push(newGroup);
      groupByStationId.set(station.id, newGroup);
    }
  }

  return groups;
}

export type TrackSegment = {
  lineId: string;
  fromStationId: string;
  toStationId: string;
  path: Coordinate[];
};

export type TrainAction = {
  from_stop_id: string;
  from_timestamp: number;
  to_stop_id: string;
  to_timestamp: number;
};

export type TrainActions = Record<string, Record<string, TrainAction[]>>;

export type ElizabethLineArrival = {
  id?: string;
  lineId?: string;
  vehicleId?: string;
  naptanId?: string;
  stationName?: string;
  destinationNaptanId?: string;
  destinationName?: string;
  expectedArrival?: string;
  direction?: string;
  timeToStation: number;
};

export type TfLRouteData = {
  stations: TubeStation[];
  segments: TrackSegment[];
  linePaths: Coordinate[][];
};

export function parseOsmRailPaths(data: unknown, lineId: string): Coordinate[][] {
  if (!isRecord(data) || !Array.isArray(data[lineId])) {
    throw new Error(`${lineId} OpenStreetMap rail data has an invalid structure`);
  }

  const paths: Coordinate[][] = [];
  for (const rawPath of data[lineId]) {
    if (!Array.isArray(rawPath) || !rawPath.every(isCoordinate)) continue;
    if (rawPath.length >= 2) paths.push(rawPath);
  }

  if (paths.length === 0) throw new Error(`${lineId} OpenStreetMap data contains no rail paths`);
  return paths;
}

export async function fetchOsmRailPaths(
  lineId: "metropolitan" | "dlr" | "tram",
): Promise<Coordinate[][]> {
  const response = await fetch("/data/rail-track-geometries.json");
  if (!response.ok) {
    throw new Error(`OpenStreetMap rail geometry unavailable (${response.status})`);
  }
  return parseOsmRailPaths(await response.json(), lineId);
}

export type TrainPosition = {
  lineId: string;
  trainId: string;
  coordinates: Coordinate;
  fromStationId: string;
  toStationId: string;
  progressPercent: number;
  futureStops: { stationName: string; arrivalTimestamp: number }[];
  routeStartStationId?: string;
  routeEndStationId?: string;
};

export type RawStation = {
  name: string;
  latitude: number;
  longitude: number;
};

export type RawTrainActions = {
  actions: TrainActions;
};

export type ElizabethLineData = {
  stations: TubeStation[];
  segments: TrackSegment[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '"') {
      if (quoted && row[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(value);
      value = "";
    } else {
      value += character;
    }
  }

  fields.push(value);
  return fields;
}

export function parseTubeTrackCsv(csv: string): TrackSegment[] {
  const rows = csv.split(/\r?\n/);
  const segments: TrackSegment[] = [];

  for (const row of rows.slice(1)) {
    if (!row.trim()) continue;
    const [lineId, fromStationId, toStationId, pathValue] = parseCsvRow(row);
    if (!lineId || !fromStationId || !toStationId || !pathValue) continue;

    let parsedPath: unknown;
    try {
      parsedPath = JSON.parse(pathValue);
    } catch (error) {
      console.error(`Invalid track geometry for ${lineId} ${fromStationId}-${toStationId}`, error);
      continue;
    }

    if (
      !Array.isArray(parsedPath) ||
      parsedPath.length < 2 ||
      !parsedPath.every(
        (point): point is Coordinate =>
          Array.isArray(point) &&
          point.length >= 2 &&
          typeof point[0] === "number" &&
          Number.isFinite(point[0]) &&
          typeof point[1] === "number" &&
          Number.isFinite(point[1]),
      )
    ) {
      continue;
    }

    const path = parsedPath as Coordinate[];
    segments.push({ lineId, fromStationId, toStationId, path });
  }

  return segments;
}

function coordinateDistance(first: Coordinate, second: Coordinate): number {
  const latitudeScale = Math.cos((second[1] * Math.PI) / 180);
  return Math.hypot((first[0] - second[0]) * latitudeScale, first[1] - second[1]);
}

export function snapTrackSegmentsToStations(
  segments: TrackSegment[],
  stations: TubeStation[],
): TrackSegment[] {
  const stationById = new Map(stations.map((station) => [station.id, station]));
  return segments.map((segment) => {
    const fromStation = stationById.get(segment.fromStationId);
    const toStation = stationById.get(segment.toStationId);
    if (!fromStation || !toStation || segment.path.length < 2) return segment;

    const first = segment.path[0];
    const last = segment.path.at(-1);
    if (!first || !last) return segment;
    const normalDistance =
      coordinateDistance(first, fromStation.coordinates) +
      coordinateDistance(last, toStation.coordinates);
    const reversedDistance =
      coordinateDistance(last, fromStation.coordinates) +
      coordinateDistance(first, toStation.coordinates);
    const path = reversedDistance < normalDistance ? [...segment.path].reverse() : segment.path;
    return {
      ...segment,
      path: [fromStation.coordinates, ...path, toStation.coordinates],
    };
  });
}

export function getTrackEndpointConnectors(
  segments: TrackSegment[],
  maxDistanceMeters = 50,
): TrackSegment[] {
  const connectors: TrackSegment[] = [];
  for (const segment of segments) {
    if (segment.path.length < 4) continue;
    const start = segment.path[0];
    const firstRailPoint = segment.path[1];
    const end = segment.path.at(-1);
    const lastRailPoint = segment.path.at(-2);
    if (!start || !firstRailPoint || !end || !lastRailPoint) continue;
    const startGap = coordinateDistance(start, firstRailPoint) * 111_320;
    const endGap = coordinateDistance(end, lastRailPoint) * 111_320;
    if (startGap > 1 && startGap <= maxDistanceMeters) {
      connectors.push({
        lineId: segment.lineId,
        fromStationId: segment.fromStationId,
        toStationId: segment.fromStationId,
        path: [start, firstRailPoint],
      });
    }
    if (endGap > 1 && endGap <= maxDistanceMeters) {
      connectors.push({
        lineId: segment.lineId,
        fromStationId: segment.toStationId,
        toStationId: segment.toStationId,
        path: [lastRailPoint, end],
      });
    }
  }
  return connectors;
}

export function parseElizabethLineData(data: unknown): ElizabethLineData {
  if (!isRecord(data) || !Array.isArray(data["branches"])) {
    throw new Error("Elizabeth line track data has an invalid structure");
  }

  const segments: TrackSegment[] = [];
  const stationsById = new Map<string, TubeStation>();
  const seenConnections = new Set<string>();

  for (const branch of data["branches"]) {
    if (!isRecord(branch)) continue;
    const stops = branch["stops"];
    const branchSegments = branch["segments"];
    if (!Array.isArray(stops) || !Array.isArray(branchSegments)) continue;

    for (const stop of stops) {
      if (
        !isRecord(stop) ||
        typeof stop["id"] !== "string" ||
        typeof stop["name"] !== "string" ||
        typeof stop["lon"] !== "number" ||
        !Number.isFinite(stop["lon"]) ||
        typeof stop["lat"] !== "number" ||
        !Number.isFinite(stop["lat"])
      ) {
        continue;
      }
      stationsById.set(stop["id"], {
        id: stop["id"],
        name: stop["name"],
        coordinates: [stop["lon"], stop["lat"]],
      });
    }

    for (let index = 0; index < stops.length - 1; index += 1) {
      const from = stops[index];
      const to = stops[index + 1];
      const path = branchSegments[index];
      if (!isRecord(from) || !isRecord(to)) continue;
      const fromStationId = from["id"];
      const toStationId = to["id"];
      if (
        typeof fromStationId !== "string" ||
        typeof toStationId !== "string" ||
        !Array.isArray(path) ||
        path.length < 2 ||
        !path.every(isCoordinate)
      ) {
        continue;
      }

      const connectionKey = [fromStationId, toStationId].sort().join(":");
      if (seenConnections.has(connectionKey)) continue;
      seenConnections.add(connectionKey);
      segments.push({ lineId: "elizabeth", fromStationId, toStationId, path });
    }
  }

  if (stationsById.size === 0 || segments.length === 0) {
    throw new Error("Elizabeth line track data contains no usable routes");
  }

  return { stations: [...stationsById.values()], segments };
}

export async function fetchElizabethLineData(): Promise<ElizabethLineData> {
  const response = await fetch("/data/elizabeth-line-branches.json");
  if (!response.ok) {
    throw new Error(`Elizabeth line track geometry unavailable (${response.status})`);
  }
  return parseElizabethLineData(await response.json());
}

function collectGeometryPaths(value: unknown, paths: Coordinate[][]): void {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && value.every(isCoordinate)) {
    paths.push(value);
    return;
  }
  for (const nested of value) collectGeometryPaths(nested, paths);
}

function stationFromRoutePoint(value: unknown): TubeStation | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value["id"] === "string" ? value["id"] : value["stationId"];
  const name = value["name"];
  const latitude = value["lat"];
  const longitude = value["lon"];
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude)
  ) {
    return undefined;
  }
  return {
    id,
    name: name.replace(/ (?:Underground|Rail|Metropolitan|DLR|Tram) (?:Station|Stop)$/, ""),
    coordinates: [longitude, latitude],
  };
}

function projectStationOntoPath(
  station: TubeStation,
  path: Coordinate[],
): { measure: number; distance: number } | undefined {
  let best: { measure: number; distance: number } | undefined;
  const latitudeScale = Math.cos((station.coordinates[1] * Math.PI) / 180);

  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    if (!start || !end) continue;
    const startX = start[0] * latitudeScale;
    const endX = end[0] * latitudeScale;
    const stationX = station.coordinates[0] * latitudeScale;
    const dx = endX - startX;
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const ratio =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((stationX - startX) * dx + (station.coordinates[1] - start[1]) * dy) / lengthSquared,
            ),
          );
    const projectedX = startX + dx * ratio;
    const projectedY = start[1] + dy * ratio;
    const distance = Math.hypot(stationX - projectedX, station.coordinates[1] - projectedY);
    if (!best || distance < best.distance) {
      best = { measure: index + ratio, distance };
    }
  }
  return best;
}

export function parseTfLRouteSequence(data: unknown, lineId: string): TfLRouteData {
  if (
    !isRecord(data) ||
    !Array.isArray(data["lineStrings"]) ||
    !Array.isArray(data["stopPointSequences"])
  ) {
    throw new Error(`${lineId} route sequence has an invalid structure`);
  }

  const paths: Coordinate[][] = [];
  for (const lineString of data["lineStrings"]) {
    if (typeof lineString !== "string") continue;
    let geometry: unknown;
    try {
      geometry = JSON.parse(lineString);
    } catch (error) {
      console.error(`Invalid ${lineId} route geometry`, error);
      continue;
    }
    collectGeometryPaths(geometry, paths);
  }
  if (paths.length === 0) throw new Error(`${lineId} route sequence contains no usable geometry`);

  const stationsById = new Map<string, TubeStation>();
  const rawStations = data["stations"];
  if (Array.isArray(rawStations)) {
    for (const rawStation of rawStations) {
      const station = stationFromRoutePoint(rawStation);
      if (station) stationsById.set(station.id, station);
    }
  }

  const segments: TrackSegment[] = [];
  for (const sequence of data["stopPointSequences"]) {
    if (!isRecord(sequence) || !Array.isArray(sequence["stopPoint"])) continue;
    const stops = sequence["stopPoint"]
      .map(stationFromRoutePoint)
      .filter((station): station is TubeStation => station !== undefined);
    for (const station of stops) stationsById.set(station.id, station);
    if (stops.length < 2) continue;

    let best: { path: Coordinate[]; measures: number[]; score: number } | undefined;
    for (const path of paths) {
      const measures: number[] = [];
      let score = 0;
      for (const station of stops) {
        const location = projectStationOntoPath(station, path);
        if (!location) continue;
        measures.push(location.measure);
        score += location.distance;
      }
      if (measures.length !== stops.length) continue;
      const ascending = measures.every(
        (measure, i) => i === 0 || measure >= (measures[i - 1] ?? 0),
      );
      const descending = measures.every(
        (measure, i) => i === 0 || measure <= (measures[i - 1] ?? 0),
      );
      if (!ascending && !descending) continue;
      const averageDistance = score / stops.length;
      if (averageDistance > 0.002) continue;
      if (!best || averageDistance < best.score) {
        best = { path, measures, score: averageDistance };
      }
    }
    if (!best) continue;

    for (let index = 0; index < stops.length - 1; index += 1) {
      const from = stops[index];
      const to = stops[index + 1];
      const fromMeasure = best.measures[index];
      const toMeasure = best.measures[index + 1];
      if (
        !from ||
        !to ||
        fromMeasure === undefined ||
        toMeasure === undefined ||
        Math.abs(fromMeasure - toMeasure) < 0.001
      ) {
        continue;
      }
      const path: Coordinate[] = [from.coordinates];
      if (fromMeasure < toMeasure) {
        for (
          let pathIndex = Math.floor(fromMeasure) + 1;
          pathIndex <= Math.floor(toMeasure);
          pathIndex += 1
        ) {
          if (pathIndex >= toMeasure) break;
          const coordinate = best.path[pathIndex];
          if (coordinate) path.push(coordinate);
        }
      } else {
        for (
          let pathIndex = Math.ceil(fromMeasure) - 1;
          pathIndex >= Math.ceil(toMeasure);
          pathIndex -= 1
        ) {
          if (pathIndex <= toMeasure) break;
          const coordinate = best.path[pathIndex];
          if (coordinate) path.push(coordinate);
        }
      }
      path.push(to.coordinates);
      if (path.length >= 2) {
        segments.push({
          lineId,
          fromStationId: from.id,
          toStationId: to.id,
          path,
        });
      }
    }
  }

  if (stationsById.size === 0 || segments.length === 0) {
    throw new Error(`${lineId} route sequence contains no usable station paths`);
  }
  return { stations: [...stationsById.values()], segments, linePaths: paths };
}

export async function fetchTfLRouteData(
  lineId: string,
  direction: "inbound" | "outbound" = "outbound",
): Promise<TfLRouteData> {
  const response = await fetch(`https://api.tfl.gov.uk/Line/${lineId}/Route/Sequence/${direction}`);
  if (!response.ok) {
    throw new Error(`${lineId} ${direction} route sequence unavailable (${response.status})`);
  }
  return parseTfLRouteSequence(await response.json(), lineId);
}

export async function fetchElizabethLineArrivals(): Promise<ElizabethLineArrival[]> {
  const response = await fetch("https://api.tfl.gov.uk/Line/elizabeth/Arrivals");
  if (!response.ok) throw new Error(`Elizabeth line train feed unavailable (${response.status})`);
  return response.json();
}

export async function fetchTubeMapData(): Promise<{
  stations: TubeStation[];
  segments: TrackSegment[];
}> {
  const [stationsResponse, tracksResponse] = await Promise.all([
    fetch(`${MAP_DATA_URL}/2_tube_stations_manually_tweaked.json`),
    fetch(`${MAP_DATA_URL}/4_tube_connections_with_paths.csv`),
  ]);

  if (!stationsResponse.ok) {
    throw new Error(`Station map unavailable (${stationsResponse.status})`);
  }
  if (!tracksResponse.ok) {
    throw new Error(`Tube track geometry unavailable (${tracksResponse.status})`);
  }

  const [rawStations, csv] = await Promise.all([
    stationsResponse.json() as Promise<Record<string, RawStation>>,
    tracksResponse.text(),
  ]);
  const stations = Object.entries(rawStations)
    .filter(
      ([, station]) => Number.isFinite(station.latitude) && Number.isFinite(station.longitude),
    )
    .map(([id, station]) => ({
      id,
      name: station.name.replace(/ Underground Station$/, "").trim(),
      coordinates: [station.longitude, station.latitude] as Coordinate,
    }));
  const segments = parseTubeTrackCsv(csv);

  if (stations.length === 0) throw new Error("Station map contains no usable stations");
  if (segments.length === 0) throw new Error("Tube track data contains no usable routes");

  return { stations, segments };
}

export async function fetchTrainActions(): Promise<TrainActions> {
  const response = await fetch(TRAIN_ACTIONS_URL);
  if (!response.ok) {
    throw new Error(`Live train feed unavailable (${response.status})`);
  }
  const data: RawTrainActions = await response.json();
  return data.actions;
}

function interpolatePath(path: Coordinate[], progress: number): Coordinate {
  const first = path[0];
  if (!first) throw new Error("Cannot interpolate an empty track segment");
  if (path.length === 1) return first;

  const lengths = path.slice(1).map((point, index) => {
    const previous = path[index];
    if (!previous) return 0;
    const latitudeScale = Math.cos(((previous[1] + point[1]) * Math.PI) / 180);
    return Math.hypot((point[0] - previous[0]) * latitudeScale, point[1] - previous[1]);
  });
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  if (totalLength === 0) return first;

  let remaining = totalLength * Math.max(0, Math.min(1, progress));
  for (let index = 0; index < lengths.length; index += 1) {
    const segmentLength = lengths[index];
    const start = path[index];
    const end = path[index + 1];
    if (segmentLength === undefined || !start || !end) continue;
    if (remaining <= segmentLength || index === lengths.length - 1) {
      const ratio = segmentLength === 0 ? 0 : remaining / segmentLength;
      return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
    }
    remaining -= segmentLength;
  }

  return path[path.length - 1] ?? first;
}

export function snapCoordinateToRailPaths(
  coordinate: Coordinate,
  paths: Coordinate[][],
  maxDistanceMeters = 150,
): Coordinate {
  let nearestCoordinate = coordinate;
  let nearestDistance = maxDistanceMeters;
  const latitudeScale = 111_320;
  const longitudeScale = latitudeScale * Math.cos((coordinate[1] * Math.PI) / 180);

  for (const path of paths) {
    for (let index = 0; index < path.length - 1; index += 1) {
      const first = path[index];
      const second = path[index + 1];
      if (!first || !second) continue;
      const dx = (second[0] - first[0]) * longitudeScale;
      const dy = (second[1] - first[1]) * latitudeScale;
      const segmentLengthSquared = dx * dx + dy * dy;
      if (segmentLengthSquared === 0) continue;
      const pointX = (coordinate[0] - first[0]) * longitudeScale;
      const pointY = (coordinate[1] - first[1]) * latitudeScale;
      const progress = Math.max(0, Math.min(1, (pointX * dx + pointY * dy) / segmentLengthSquared));
      const projected: Coordinate = [
        first[0] + (second[0] - first[0]) * progress,
        first[1] + (second[1] - first[1]) * progress,
      ];
      const distance = Math.hypot(
        (coordinate[0] - projected[0]) * longitudeScale,
        (coordinate[1] - projected[1]) * latitudeScale,
      );
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestCoordinate = projected;
      }
    }
  }

  return nearestCoordinate;
}

function resolveTrainTrackPath(
  lineId: string,
  fromStationId: string,
  toStationId: string,
  segmentPathByKey: Record<string, Coordinate[]>,
  adjacentStations: Record<string, string[]>,
): Coordinate[] | undefined {
  const directPath = segmentPathByKey[`${lineId}:${fromStationId}:${toStationId}`];
  if (directPath) return directPath;

  const previousStation = new Map<string, string | null>([[fromStationId, null]]);
  const queue = [fromStationId];
  for (let index = 0; index < queue.length; index += 1) {
    const stationId = queue[index];
    if (!stationId) continue;
    if (stationId === toStationId) break;
    for (const nextStationId of adjacentStations[`${lineId}:${stationId}`] ?? []) {
      if (previousStation.has(nextStationId)) continue;
      previousStation.set(nextStationId, stationId);
      queue.push(nextStationId);
    }
  }
  if (!previousStation.has(toStationId)) return undefined;

  const stationPath = [toStationId];
  let stationId = toStationId;
  while (stationId !== fromStationId) {
    const previous = previousStation.get(stationId);
    if (previous === undefined || previous === null) return undefined;
    stationPath.push(previous);
    stationId = previous;
  }
  stationPath.reverse();

  const path: Coordinate[] = [];
  for (let index = 0; index < stationPath.length - 1; index += 1) {
    const from = stationPath[index];
    const to = stationPath[index + 1];
    if (!from || !to) continue;
    const segment = segmentPathByKey[`${lineId}:${from}:${to}`];
    if (!segment) return undefined;
    path.push(...(index === 0 ? segment : segment.slice(1)));
  }
  return path.length > 1 ? path : undefined;
}

export function getTrainPositions(
  actions: TrainActions,
  segments: TrackSegment[],
  stations: TubeStation[],
  timestampSeconds: number,
): TrainPosition[] {
  const positions: TrainPosition[] = [];
  const stationById = new Map(stations.map((s) => [s.id, s]));
  const adjacentStations: Record<string, string[]> = {};
  const segmentPathByKey: Record<string, Coordinate[]> = {};

  for (const segment of segments) {
    const { lineId, fromStationId, toStationId, path } = segment;
    if (!lineId) continue;

    adjacentStations[`${lineId}:${fromStationId}`] = [
      ...(adjacentStations[`${lineId}:${fromStationId}`] ?? []),
      toStationId,
    ];
    adjacentStations[`${lineId}:${toStationId}`] = [
      ...(adjacentStations[`${lineId}:${toStationId}`] ?? []),
      fromStationId,
    ];
    segmentPathByKey[`${lineId}:${fromStationId}:${toStationId}`] = path;
    segmentPathByKey[`${lineId}:${toStationId}:${fromStationId}`] = [...path].reverse();
  }

  for (const [lineId, trains] of Object.entries(actions)) {
    for (const [trainId, trainActions] of Object.entries(trains)) {
      for (const [actionIndex, action] of trainActions.entries()) {
        const { from_stop_id, from_timestamp, to_stop_id, to_timestamp } = action;
        if (!from_stop_id || !to_stop_id) continue;
        const fromStation = stationById.get(from_stop_id);
        const toStation = stationById.get(to_stop_id);
        if (!fromStation || !toStation) continue;

        const fromTimestamp = from_timestamp;
        const toTimestamp = to_timestamp;

        if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp)) continue;

        const duration = toTimestamp - fromTimestamp;
        if (duration <= 0) continue;

        const elapsed = timestampSeconds - fromTimestamp;
        if (elapsed < 0 || timestampSeconds >= toTimestamp) continue;
        const progress = elapsed / duration;
        if (from_stop_id === to_stop_id) {
          positions.push({
            lineId,
            trainId,
            coordinates: fromStation.coordinates,
            fromStationId: from_stop_id,
            toStationId: to_stop_id,
            progressPercent: 0,
            futureStops: [],
          });
          continue;
        }

        const path = resolveTrainTrackPath(
          lineId,
          from_stop_id,
          to_stop_id,
          segmentPathByKey,
          adjacentStations,
        );
        if (!path) continue;
        const futureStops: TrainPosition["futureStops"] = [];
        const seenStopIds = new Set<string>();
        for (const futureAction of trainActions.slice(actionIndex)) {
          const futureStation = stationById.get(futureAction.to_stop_id);
          if (
            !futureStation ||
            futureAction.to_timestamp < timestampSeconds ||
            seenStopIds.has(futureStation.id)
          ) {
            continue;
          }
          seenStopIds.add(futureStation.id);
          futureStops.push({
            stationName: futureStation.name,
            arrivalTimestamp: futureAction.to_timestamp,
          });
        }
        const trainActionsForLine: any = (trainActions as any)[lineId];
        const trainActionListAny: any = trainActionsForLine ? trainActionsForLine[trainId] : undefined;
        const list: any[] = Array.isArray(trainActionListAny) ? trainActionListAny : [];
        let firstAction: any = list.length > 0 ? list[0] : undefined;
        let lastAction: any = list.length > 0 ? list[list.length - 1] : undefined;
        const position: TrainPosition = {
          lineId,
          trainId,
          coordinates: interpolatePath(path, progress),
          fromStationId: from_stop_id,
          toStationId: to_stop_id,
          progressPercent: progress * 100,
          futureStops,
        };
        if (firstAction?.from_stop_id) position.routeStartStationId = firstAction.from_stop_id;
        if (lastAction?.to_stop_id) position.routeEndStationId = lastAction.to_stop_id;
        positions.push(position);
      }
    }
  }

  return positions;
}

function normalizeStationName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(?:london|underground|rail|metropolitan|dlr|tram|station|stop)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function getLineTrainPositions(
  arrivals: ElizabethLineArrival[],
  lineId: string,
  segments: TrackSegment[],
  stations: TubeStation[],
  timestampSeconds: number,
  maxPredictionSeconds?: number,
  predictionElapsedSeconds = 0,
): TrainPosition[] {
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const stationByName = new Map(
    stations.map((station) => [normalizeStationName(station.name), station]),
  );
  const adjacentStations = new Map<string, Set<string>>();
  const segmentByKey = new Map<string, Coordinate[]>();

  for (const segment of segments) {
    if (segment.lineId !== lineId) continue;
    segmentByKey.set(`${segment.fromStationId}:${segment.toStationId}`, segment.path);
    segmentByKey.set(
      `${segment.toStationId}:${segment.fromStationId}`,
      [...segment.path].reverse(),
    );
    for (const [from, to] of [
      [segment.fromStationId, segment.toStationId],
      [segment.toStationId, segment.fromStationId],
    ] as const) {
      const adjacent = adjacentStations.get(from) ?? new Set<string>();
      adjacent.add(to);
      adjacentStations.set(from, adjacent);
    }
  }

  const predictionsByTrain = new Map<
    string,
    Map<string, { arrival: ElizabethLineArrival; station: TubeStation }>
  >();
  for (const arrival of arrivals) {
    if (!Number.isFinite(arrival.timeToStation) || arrival.timeToStation < 0) continue;
    if (maxPredictionSeconds !== undefined && arrival.timeToStation > maxPredictionSeconds) {
      continue;
    }
    const station =
      (arrival.naptanId ? stationById.get(arrival.naptanId) : undefined) ??
      (arrival.stationName
        ? stationByName.get(normalizeStationName(arrival.stationName))
        : undefined);
    if (!station) continue;
    const adjustedArrival = {
      ...arrival,
      timeToStation: Math.max(0, arrival.timeToStation - predictionElapsedSeconds),
    };

    const trainId =
      arrival.vehicleId ||
      arrival.id ||
      `${station.id}:${arrival.destinationNaptanId ?? arrival.destinationName ?? ""}`;
    const predictions = predictionsByTrain.get(trainId) ?? new Map();
    const previous = predictions.get(station.id);
    if (!previous || adjustedArrival.timeToStation < previous.arrival.timeToStation) {
      predictions.set(station.id, { arrival: adjustedArrival, station });
    }
    predictionsByTrain.set(trainId, predictions);
  }

  const positions: TrainPosition[] = [];
  for (const [trainId, predictions] of predictionsByTrain) {
    const upcoming = [...predictions.entries()].sort(
      ([, first], [, second]) => first.arrival.timeToStation - second.arrival.timeToStation,
    )[0];
    if (!upcoming) continue;
    const [toStationId, { arrival, station: toStation }] = upcoming;
    if (maxPredictionSeconds !== undefined && arrival.timeToStation > maxPredictionSeconds) {
      continue;
    }
    const destination =
      (arrival.destinationNaptanId ? stationById.get(arrival.destinationNaptanId) : undefined) ??
      (arrival.destinationName
        ? stationByName.get(normalizeStationName(arrival.destinationName))
        : undefined);
    const destinationDistances = new Map<string, number>();
    if (destination) {
      const queue = [destination.id];
      destinationDistances.set(destination.id, 0);
      for (let index = 0; index < queue.length; index += 1) {
        const stationId = queue[index];
        if (!stationId) continue;
        const distance = destinationDistances.get(stationId) ?? 0;
        for (const adjacentId of adjacentStations.get(stationId) ?? []) {
          if (destinationDistances.has(adjacentId)) continue;
          destinationDistances.set(adjacentId, distance + 1);
          queue.push(adjacentId);
        }
      }
    }

    let currentStationId = toStationId;
    let remainingTime = arrival.timeToStation;
    let position:
      | {
          fromStationId: string;
          toStationId: string;
          path: Coordinate[];
          progress: number;
        }
      | undefined;
    let furthestPosition: typeof position;
    const visited = new Set<string>([toStationId]);

    for (let hop = 0; hop < 50; hop += 1) {
      const currentDistance = destinationDistances.get(currentStationId);
      const previousCandidates = [...(adjacentStations.get(currentStationId) ?? [])]
        .filter((candidate) => !visited.has(candidate))
        .filter((candidate) => {
          const distance = destinationDistances.get(candidate);
          return (
            currentDistance === undefined || distance === undefined || distance > currentDistance
          );
        })
        .sort((first, second) => {
          const firstDistance = destinationDistances.get(first) ?? Number.POSITIVE_INFINITY;
          const secondDistance = destinationDistances.get(second) ?? Number.POSITIVE_INFINITY;
          return secondDistance - firstDistance;
        });
      const fromStationId = previousCandidates.find((candidate) =>
        segmentByKey.has(`${candidate}:${currentStationId}`),
      );
      if (!fromStationId) break;

      const path = segmentByKey.get(`${fromStationId}:${currentStationId}`);
      if (!path) break;
      const segmentDuration = Math.max(60, pathLengthMeters(path) / 14);
      if (remainingTime <= segmentDuration) {
        position = {
          fromStationId,
          toStationId: currentStationId,
          path,
          progress: Math.max(0, 1 - remainingTime / segmentDuration),
        };
        break;
      }

      remainingTime -= segmentDuration;
      furthestPosition = {
        fromStationId,
        toStationId: currentStationId,
        path,
        progress: 0,
      };
      visited.add(fromStationId);
      currentStationId = fromStationId;
    }
    position ??= furthestPosition;
    if (!position) continue;

    const firstPrediction = [...predictions.entries()].sort(([, a], [, b]) => b.arrival.timeToStation - a.arrival.timeToStation)[predictions.size - 1];
    const routeStartStationId = firstPrediction?.[0] || position.fromStationId;
    const routeEndStationId = destination?.id || toStationId;
    positions.push({
      lineId,
      trainId,
      coordinates: interpolatePath(position.path, position.progress),
      fromStationId: position.fromStationId,
      toStationId: position.toStationId,
      progressPercent: position.progress * 100,
      futureStops: [
        {
          stationName: toStation.name,
          arrivalTimestamp: timestampSeconds + arrival.timeToStation,
        },
      ],
      routeStartStationId,
      routeEndStationId,
    });
  }

  return positions;
}

export function getElizabethLineTrainPositions(
  arrivals: ElizabethLineArrival[],
  segments: TrackSegment[],
  stations: TubeStation[],
  timestampSeconds: number,
  predictionElapsedSeconds = 0,
): TrainPosition[] {
  return getLineTrainPositions(
    arrivals,
    "elizabeth",
    segments,
    stations,
    timestampSeconds,
    undefined,
    predictionElapsedSeconds,
  );
}

export function secondsSinceUtcMidnight(date: Date): number {
  return (
    date.getUTCHours() * 3600 +
    date.getUTCMinutes() * 60 +
    date.getUTCSeconds() +
    date.getUTCMilliseconds() / 1000
  );
}

function pathLengthMeters(path: Coordinate[]): number {
  let length = 0;

  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    if (!from || !to) continue;

    const latitudeScale = Math.cos(((from[1] + to[1]) * Math.PI) / 180);
    length += Math.hypot((to[0] - from[0]) * latitudeScale, to[1] - from[1]) * 111_320;
  }

  return length;
}
