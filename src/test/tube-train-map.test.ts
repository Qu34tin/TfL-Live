import { describe, expect, it, vi } from "vitest";
import {
  getLineTrainPositions,
  getElizabethLineTrainPositions,
  getTrackEndpointConnectors,
  parseOsmRailPaths,
  fetchOsmRailPaths,
  getTrainPositions,
  parseTfLRouteSequence,
  parseElizabethLineData,
  parseTubeTrackCsv,
  snapTrackSegmentsToStations,
  snapCoordinateToRailPaths,
  secondsSinceUtcMidnight,
  type TrainActions,
  type TrackSegment,
  type TubeStation,
} from "@/lib/tube-train-map";
import { buildTrainTooltipHtml } from "@/lib/train-tooltip";
import {
  fetchAllStations,
  fetchLineArrivals,
  fetchLineStatus,
  fetchOvergroundArrivals,
  fetchStationAccessibility,
  OVERGROUND_LINE_IDS,
} from "@/lib/tfl";

describe("tube train map data", () => {
  it("parses detailed OSM rail paths without simplifying their rail vertices", () => {
    const paths = parseOsmRailPaths(
      {
        metropolitan: [
          [
            [-0.1, 51.5],
            [-0.101, 51.501],
            [-0.102, 51.502],
          ],
          [[1, 1]],
        ],
      },
      "metropolitan",
    );

    expect(paths).toEqual([
      [
        [-0.1, 51.5],
        [-0.101, 51.501],
        [-0.102, 51.502],
      ],
    ]);
  });

  it("parses detailed OSM geometry for Overground lines", () => {
    const paths = parseOsmRailPaths(
      {
        liberty: [
          [
            [0.18423, 51.57498],
            [0.1871, 51.57582],
            [0.22012, 51.56865],
          ],
        ],
      },
      "liberty",
    );

    expect(paths).toEqual([
      [
        [0.18423, 51.57498],
        [0.1871, 51.57582],
        [0.22012, 51.56865],
      ],
    ]);
  });

  it("loads local OSM rail geometry instead of relying on a schematic route feed", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        metropolitan: [
          [
            [-0.1, 51.5],
            [-0.101, 51.501],
          ],
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(fetchOsmRailPaths("metropolitan")).resolves.toEqual([
        [
          [-0.1, 51.5],
          [-0.101, 51.501],
        ],
      ]);
      expect(fetchMock).toHaveBeenCalledWith("/data/rail-track-geometries.json");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("parses exact Elizabeth line station-to-station paths without reverse duplicates", () => {
    const { stations, segments } = parseElizabethLineData({
      lineId: "elizabeth",
      branches: [
        {
          stops: [
            { id: "A", name: "Alpha", lon: 0, lat: 0 },
            { id: "B", name: "Beta", lon: 0.002, lat: 0 },
            { id: "C", name: "Gamma", lon: 0.003, lat: 0 },
          ],
          segments: [
            [
              [0, 0],
              [0.001, 0.001],
              [0.002, 0],
            ],
            [
              [0.002, 0],
              [0.003, 0],
            ],
          ],
        },
        {
          stops: [
            { id: "C", name: "Gamma", lon: 0.003, lat: 0 },
            { id: "B", name: "Beta", lon: 0.002, lat: 0 },
          ],
          segments: [
            [
              [0.003, 0],
              [0.002, 0],
              [0.001, 0.001],
            ],
          ],
        },
      ],
    });

    expect(stations).toEqual([
      { id: "A", name: "Alpha", coordinates: [0, 0] },
      { id: "B", name: "Beta", coordinates: [0.002, 0] },
      { id: "C", name: "Gamma", coordinates: [0.003, 0] },
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.path).toEqual([
      [0, 0],
      [0.001, 0.001],
      [0.002, 0],
    ]);
  });

  it("includes Elizabeth line status alongside Tube lines", async () => {
    const tubeStatus = [{ id: "central", name: "Central", lineStatuses: [] }];
    const elizabethStatus = [{ id: "elizabeth", name: "Elizabeth line", lineStatuses: [] }];
    const overgroundStatus = [{ id: "lioness", name: "Lioness", lineStatuses: [] }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => tubeStatus })
      .mockResolvedValueOnce({ ok: true, json: async () => elizabethStatus })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => overgroundStatus });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(fetchLineStatus()).resolves.toEqual([
        ...tubeStatus,
        ...elizabethStatus,
        ...overgroundStatus,
      ]);
      expect(fetchMock).toHaveBeenNthCalledWith(2, "https://api.tfl.gov.uk/Line/elizabeth/Status");
      expect(fetchMock).toHaveBeenNthCalledWith(
        5,
        "https://api.tfl.gov.uk/Line/Mode/overground/Status",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("includes Elizabeth line stations in the departure board search", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => ({
      ok: true,
      json: async () =>
        String(input).endsWith("/Line/elizabeth/StopPoints")
          ? [
              {
                naptanId: "910GBONDST",
                commonName: "Bond Street",
                lat: 51.5142,
                lon: -0.1494,
              },
            ]
          : [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const stations = await fetchAllStations();
      expect(stations).toContainEqual({
        id: "910GBONDST",
        name: "Bond Street",
        lat: 51.5142,
        lon: -0.1494,
        lines: ["elizabeth"],
      });
      expect(fetchMock).toHaveBeenCalledWith("https://api.tfl.gov.uk/Line/elizabeth/StopPoints");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fetches TfL accessibility and lift details for a station", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        additionalProperties: [
          { key: "AccessViaLift", value: "No" },
          { key: "LimitedCapacityLift", value: "No" },
          { key: "Lifts", value: "0" },
          { key: "Toilets", value: "no" },
          { key: "WiFi", value: "yes" },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(fetchStationAccessibility("940GZZLUOXC")).resolves.toEqual([
        { label: "Access Via Lift", value: "No" },
        { label: "Limited Capacity Lift", value: "No" },
        { label: "Lifts", value: "0" },
        { label: "Toilets", value: "no" },
      ]);
      expect(fetchMock).toHaveBeenCalledWith("https://api.tfl.gov.uk/StopPoint/940GZZLUOXC");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("parses TfL route geometry into station-to-station segments", () => {
    const route = parseTfLRouteSequence(
      {
        stations: [
          { id: "A", name: "Alpha Metropolitan Station", lat: 51.5001, lon: -0.1001 },
          { id: "B", name: "Beta Metropolitan Station", lat: 51.5101, lon: -0.1101 },
          { id: "C", name: "Watford Metropolitan Station", lat: 51.5201, lon: -0.1201 },
        ],
        lineStrings: ["[[[-0.1,51.5],[-0.105,51.505],[-0.11,51.51],[-0.12,51.52]]]"],
        stopPointSequences: [
          {
            stopPoint: [
              { id: "A", name: "Alpha Metropolitan Station", lat: 51.5001, lon: -0.1001 },
              { id: "B", name: "Beta Metropolitan Station", lat: 51.5101, lon: -0.1101 },
              { id: "C", name: "Watford Metropolitan Station", lat: 51.5201, lon: -0.1201 },
            ],
          },
        ],
      },
      "metropolitan",
    );

    expect(route.segments).toHaveLength(2);
    expect(route.segments[0]).toMatchObject({
      lineId: "metropolitan",
      fromStationId: "A",
      toStationId: "B",
      path: expect.arrayContaining([
        [-0.1001, 51.5001],
        [-0.105, 51.505],
        [-0.1101, 51.5101],
      ]),
    });

    expect(route.segments[1]).toMatchObject({
      toStationId: "C",
      path: expect.arrayContaining([[-0.1201, 51.5201]]),
    });
    expect(route.stations.map((station) => station.name)).toEqual(["Alpha", "Beta", "Watford"]);
    expect(route.linePaths).toEqual([
      [
        [-0.1, 51.5],
        [-0.105, 51.505],
        [-0.11, 51.51],
        [-0.12, 51.52],
      ],
    ]);
  });

  it("preserves precise TfL route paths for Overground map tracks", () => {
    const routePath = [
      [-0.1, 51.5],
      [-0.101, 51.501],
      [-0.102, 51.502],
    ];
    const route = parseTfLRouteSequence(
      {
        stations: [
          { id: "A", name: "Alpha Rail Station", lat: 51.5, lon: -0.1 },
          { id: "B", name: "Beta Rail Station", lat: 51.502, lon: -0.102 },
        ],
        lineStrings: [JSON.stringify([routePath])],
        stopPointSequences: [
          {
            stopPoint: [
              { id: "A", name: "Alpha Rail Station", lat: 51.5, lon: -0.1 },
              { id: "B", name: "Beta Rail Station", lat: 51.502, lon: -0.102 },
            ],
          },
        ],
      },
      "windrush",
    );

    expect(route.linePaths).toEqual([routePath]);
    expect(route.segments[0]?.path).toContainEqual([-0.101, 51.501]);
  });

  it("loads DLR and Tram arrivals from their TfL feeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "dlr-1", lineId: "dlr", timeToStation: 40 }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "tram-1", lineId: "tram", timeToStation: 20 }],
      });

    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(fetchLineArrivals()).resolves.toMatchObject([
        { id: "tram-1", lineId: "tram" },
        { id: "dlr-1", lineId: "dlr" },
      ]);
      expect(fetchMock).toHaveBeenNthCalledWith(1, "https://api.tfl.gov.uk/Line/dlr/Arrivals");
      expect(fetchMock).toHaveBeenNthCalledWith(2, "https://api.tfl.gov.uk/Line/tram/Arrivals");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("loads and sorts live arrivals from all six Overground line feeds", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const lineId = String(input).split("/").at(-2);
      return {
        ok: true,
        json: async () => [
          { id: `${lineId}-later`, lineId, timeToStation: 30 },
          { id: `${lineId}-sooner`, lineId, timeToStation: 10 },
        ],
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const arrivals = await fetchOvergroundArrivals();
      expect(arrivals).toHaveLength(OVERGROUND_LINE_IDS.length * 2);
      expect(arrivals[0]?.timeToStation).toBe(10);
      expect(arrivals.at(-1)?.timeToStation).toBe(30);
      expect(fetchMock).toHaveBeenCalledTimes(OVERGROUND_LINE_IDS.length);
      expect(fetchMock).toHaveBeenCalledWith("https://api.tfl.gov.uk/Line/liberty/Arrivals");
      expect(fetchMock).toHaveBeenCalledWith("https://api.tfl.gov.uk/Line/windrush/Arrivals");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("positions multiple arrivals for one station along the matching line", () => {
    const stations: TubeStation[] = [
      { id: "A", name: "Alpha", coordinates: [0, 0] },
      { id: "B", name: "Beta", coordinates: [0.002, 0] },
      { id: "C", name: "Gamma", coordinates: [0.003, 0] },
    ];
    const segments: TrackSegment[] = [
      {
        lineId: "elizabeth",
        fromStationId: "A",
        toStationId: "B",
        path: [
          [0, 0],
          [0.001, 0.001],
          [0.002, 0],
        ],
      },
      {
        lineId: "elizabeth",
        fromStationId: "B",
        toStationId: "C",
        path: [
          [0.002, 0],
          [0.003, 0],
        ],
      },
    ];
    const positions = getLineTrainPositions(
      [
        {
          vehicleId: "train-1",
          naptanId: "B",
          destinationName: "Gamma Rail Station",
          timeToStation: 30,
        },
        {
          vehicleId: "train-2",
          naptanId: "B",
          destinationName: "Gamma",
          timeToStation: 40,
        },
      ],
      "elizabeth",
      segments,
      stations,
      54_000,
    );

    expect(positions).toHaveLength(2);
    expect(positions.map((position) => position.trainId)).toEqual(["train-1", "train-2"]);
    expect(positions[0]?.coordinates[0]).toBeCloseTo(0.001);
    expect(positions[0]?.coordinates[1]).toBeCloseTo(0.001);
  });

  it("does not create extra DLR trains for repeated predictions with the same TfL id", () => {
    const stations: TubeStation[] = [
      { id: "A", name: "Alpha", coordinates: [-0.002, 0] },
      { id: "B", name: "Beta", coordinates: [0, 0] },
      { id: "C", name: "Gamma", coordinates: [0.002, 0] },
    ];
    const positions = getLineTrainPositions(
      [
        {
          id: "prediction-1",
          naptanId: "B",
          destinationName: "Alpha DLR Station",
          timeToStation: 30,
        },
        {
          id: "prediction-1",
          naptanId: "B",
          destinationName: "Alpha DLR Station",
          timeToStation: 35,
        },
      ],
      "dlr",
      [
        {
          lineId: "dlr",
          fromStationId: "C",
          toStationId: "B",
          path: [
            [0.002, 0],
            [0, 0],
          ],
        },
        {
          lineId: "dlr",
          fromStationId: "B",
          toStationId: "A",
          path: [
            [0, 0],
            [-0.002, 0],
          ],
        },
      ],
      stations,
      54_000,
    );

    expect(positions).toHaveLength(1);
    expect(positions[0]?.trainId).toBe("prediction-1");
  });

  it("keeps longer Elizabeth line predictions on the real track instead of dropping them", () => {
    const stations: TubeStation[] = [
      { id: "A", name: "Alpha", coordinates: [0, 0] },
      { id: "B", name: "Beta", coordinates: [0.1, 0] },
      { id: "C", name: "Gamma", coordinates: [0.2, 0] },
    ];
    const positions = getElizabethLineTrainPositions(
      [
        {
          vehicleId: "train-long-run",
          naptanId: "B",
          destinationNaptanId: "C",
          timeToStation: 180,
        },
      ],
      [
        {
          lineId: "elizabeth",
          fromStationId: "A",
          toStationId: "B",
          path: [
            [0, 0],
            [0.1, 0],
          ],
        },
        {
          lineId: "elizabeth",
          fromStationId: "B",
          toStationId: "C",
          path: [
            [0.1, 0],
            [0.2, 0],
          ],
        },
      ],
      stations,
      54_000,
    );

    expect(positions).toHaveLength(1);
    expect(positions[0]?.progressPercent).toBeGreaterThan(0);
    expect(positions[0]?.progressPercent).toBeLessThan(100);
  });

  it("keeps predicted train progress within its current segment after multiple stops", () => {
    const stations: TubeStation[] = ["A", "B", "C", "D"].map((id, index) => ({
      id,
      name: id,
      coordinates: [index * 0.001, 0],
    }));
    const segments = stations.slice(0, -1).map((station, index) => ({
      lineId: "tram",
      fromStationId: station.id,
      toStationId: stations[index + 1]!.id,
      path: [station.coordinates, stations[index + 1]!.coordinates],
    }));
    const positions = getLineTrainPositions(
      [
        {
          vehicleId: "tram-1",
          naptanId: "C",
          destinationNaptanId: "D",
          timeToStation: 70,
        },
      ],
      "tram",
      segments,
      stations,
      54_000,
    );

    expect(positions).toHaveLength(1);
    expect(positions[0]?.fromStationId).toBe("A");
    expect(positions[0]?.toStationId).toBe("B");
    expect(positions[0]?.progressPercent).toBeGreaterThanOrEqual(0);
    expect(positions[0]?.progressPercent).toBeLessThanOrEqual(100);
  });

  it("moves Elizabeth line trains along the real track geometry", () => {
    const stations: TubeStation[] = [
      { id: "A", name: "Alpha", coordinates: [0, 0] },
      { id: "B", name: "Beta", coordinates: [0.002, 0] },
      { id: "C", name: "Gamma", coordinates: [0.003, 0] },
    ];
    const positions = getElizabethLineTrainPositions(
      [
        {
          vehicleId: "train-1",
          naptanId: "B",
          stationName: "Beta",
          destinationName: "Gamma",
          timeToStation: 30,
        },
        {
          vehicleId: "train-1",
          naptanId: "B",
          stationName: "Beta",
          destinationName: "Gamma",
          timeToStation: 40,
        },
      ],
      [
        {
          lineId: "elizabeth",
          fromStationId: "A",
          toStationId: "B",
          path: [
            [0, 0],
            [0.001, 0.001],
            [0.002, 0],
          ],
        },
        {
          lineId: "elizabeth",
          fromStationId: "B",
          toStationId: "C",
          path: [
            [0.002, 0],
            [0.003, 0],
          ],
        },
      ],
      stations,
      54_000,
    );

    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      lineId: "elizabeth",
      trainId: "train-1",
      fromStationId: "A",
      toStationId: "B",
    });

    expect(positions[0]?.progressPercent).toBeGreaterThan(0);
    expect(positions[0]?.progressPercent).toBeLessThan(100);
    expect(positions[0]?.coordinates[0]).toBeCloseTo(0.001);
    expect(positions[0]?.coordinates[1]).toBeCloseTo(0.001);
  });

  it("moves Overground trains along their TfL route geometry", () => {
    const stations: TubeStation[] = [
      { id: "A", name: "Alpha", coordinates: [0, 0] },
      { id: "B", name: "Beta", coordinates: [0.002, 0] },
      { id: "C", name: "Gamma", coordinates: [0.003, 0] },
    ];
    const positions = getLineTrainPositions(
      [
        {
          vehicleId: "windrush-train",
          naptanId: "B",
          destinationName: "Gamma Rail Station",
          timeToStation: 30,
        },
      ],
      "windrush",
      [
        {
          lineId: "windrush",
          fromStationId: "A",
          toStationId: "B",
          path: [
            [0, 0],
            [0.001, 0.001],
            [0.002, 0],
          ],
        },
        {
          lineId: "windrush",
          fromStationId: "B",
          toStationId: "C",
          path: [
            [0.002, 0],
            [0.003, 0],
          ],
        },
      ],
      stations,
      54_000,
    );

    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      lineId: "windrush",
      trainId: "windrush-train",
      fromStationId: "A",
      toStationId: "B",
    });
    expect(positions[0]?.coordinates[0]).toBeCloseTo(0.001);
    expect(positions[0]?.coordinates[1]).toBeCloseTo(0.001);
  });

  it("advances Elizabeth, DLR, Tram and Overground trains between feed refreshes", () => {
    const stations: TubeStation[] = [
      { id: "A", name: "Alpha", coordinates: [0, 0] },
      { id: "B", name: "Beta", coordinates: [0.001, 0] },
    ];
    const arrivals = [
      {
        vehicleId: "moving-train",
        naptanId: "B",
        destinationName: "Beta",
        timeToStation: 60,
      },
    ];
    for (const lineId of ["elizabeth", "dlr", "tram", "windrush"]) {
      const segments: TrackSegment[] = [
        {
          lineId,
          fromStationId: "A",
          toStationId: "B",
          path: [
            [0, 0],
            [0.001, 0],
          ],
        },
      ];
      const firstPosition = getLineTrainPositions(arrivals, lineId, segments, stations, 54_000);
      const laterPosition = getLineTrainPositions(
        arrivals,
        lineId,
        segments,
        stations,
        54_010,
        undefined,
        10,
      );

      expect(firstPosition[0]?.coordinates[0]).toBeLessThan(laterPosition[0]!.coordinates[0]);
    }
  });

  it("snaps moving trains onto nearby detailed OSM rail geometry", () => {
    const snapped = snapCoordinateToRailPaths(
      [0.0005, 51.5005],
      [
        [
          [0, 51.5],
          [0.001, 51.5],
        ],
      ],
    );

    expect(snapped[0]).toBeCloseTo(0.0005);
    expect(snapped[1]).toBeCloseTo(51.5);
  });

  it("keeps Overground predictions within the advertised route while ignoring distant schedules", () => {
    const stations: TubeStation[] = [
      { id: "A", name: "Alpha", coordinates: [0, 0] },
      { id: "B", name: "Beta", coordinates: [0.001, 0] },
    ];
    const segments: TrackSegment[] = [
      {
        lineId: "liberty",
        fromStationId: "A",
        toStationId: "B",
        path: [
          [0, 0],
          [0.001, 0],
        ],
      },
    ];
    const arrivals = [
      {
        vehicleId: "near-train",
        naptanId: "B",
        destinationName: "Beta",
        timeToStation: 120,
      },
      {
        vehicleId: "distant-train",
        naptanId: "B",
        destinationName: "Beta",
        timeToStation: 901,
      },
    ];

    const positions = getLineTrainPositions(arrivals, "liberty", segments, stations, 54_000, 900);

    expect(positions).toHaveLength(1);
    expect(positions[0]?.trainId).toBe("near-train");
    expect(positions[0]?.coordinates).toEqual(stations[0]?.coordinates);
  });

  it("preserves fractional seconds for smooth train movement", () => {
    expect(secondsSinceUtcMidnight(new Date("2026-10-20T15:00:00.500Z"))).toBe(54_000.5);
  });

  it("parses quoted track geometry from CSV", () => {
    const segments = parseTubeTrackCsv(
      'line_id,from_station_id,to_station_id,path,segment_id,segment_line,is_straight_line\nbakerloo,A,B,"[[-0.1,51.5],[-0.2,51.6]]",segment,Bakerloo,False',
    );

    expect(segments).toEqual([
      {
        lineId: "bakerloo",
        fromStationId: "A",
        toStationId: "B",
        path: [
          [-0.1, 51.5],
          [-0.2, 51.6],
        ],
      },
    ]);
  });

  it("snaps reversed line endpoints to their station coordinates", () => {
    const stations: TubeStation[] = [
      { id: "A", name: "Alpha", coordinates: [-0.1, 51.5] },
      { id: "B", name: "Beta", coordinates: [-0.2, 51.6] },
    ];
    const segments = snapTrackSegmentsToStations(
      [
        {
          lineId: "circle",
          fromStationId: "A",
          toStationId: "B",
          path: [
            [-0.1999, 51.6001],
            [-0.15, 51.55],
            [-0.1001, 51.5001],
          ],
        },
      ],
      stations,
    );

    expect(segments[0]?.path).toEqual([
      [-0.1, 51.5],
      [-0.1001, 51.5001],
      [-0.15, 51.55],
      [-0.1999, 51.6001],
      [-0.2, 51.6],
    ]);
    expect(getTrackEndpointConnectors(segments)).toEqual([
      {
        lineId: "circle",
        fromStationId: "A",
        toStationId: "A",
        path: [
          [-0.1, 51.5],
          [-0.1001, 51.5001],
        ],
      },
      {
        lineId: "circle",
        fromStationId: "B",
        toStationId: "B",
        path: [
          [-0.1999, 51.6001],
          [-0.2, 51.6],
        ],
      },
    ]);
  });

  it("positions a moving train along its track segment using feed timestamps", () => {
    const actions: TrainActions = {
      bakerloo: {
        "train-1": [
          {
            from_stop_id: "A",
            from_timestamp: 100,
            to_stop_id: "B",
            to_timestamp: 200,
          },
          {
            from_stop_id: "B",
            from_timestamp: 200,
            to_stop_id: "B",
            to_timestamp: 240,
          },
          {
            from_stop_id: "B",
            from_timestamp: 240,
            to_stop_id: "C",
            to_timestamp: 300,
          },
        ],
      },
    };
    const stations: TubeStation[] = [
      { id: "A", name: "Alpha", coordinates: [-0.1, 51.5] },
      { id: "B", name: "Beta", coordinates: [-0.2, 51.6] },
      { id: "C", name: "Gamma", coordinates: [-0.3, 51.7] },
    ];

    const [train] = getTrainPositions(
      actions,
      [
        {
          lineId: "bakerloo",
          fromStationId: "A",
          toStationId: "B",
          path: [
            [-0.1, 51.5],
            [-0.15, 51.55],
            [-0.2, 51.6],
          ],
        },
      ],
      stations,
      150,
    );

    expect(train?.coordinates[0]).toBeCloseTo(-0.15);
    expect(train?.coordinates[1]).toBeCloseTo(51.55);
    expect(train?.progressPercent).toBe(50);
    expect(train?.futureStops).toEqual([
      { stationName: "Beta", arrivalTimestamp: 200 },
      { stationName: "Gamma", arrivalTimestamp: 300 },
    ]);
  });

  it("joins connected track segments when a live action spans multiple stations", () => {
    const actions: TrainActions = {
      central: {
        "train-express": [
          {
            from_stop_id: "A",
            from_timestamp: 100,
            to_stop_id: "C",
            to_timestamp: 200,
          },
        ],
      },
    };

    const [train] = getTrainPositions(
      actions,
      [
        {
          lineId: "central",
          fromStationId: "A",
          toStationId: "B",
          path: [
            [-0.1, 51.5],
            [-0.15, 51.55],
          ],
        },
        {
          lineId: "central",
          fromStationId: "B",
          toStationId: "C",
          path: [
            [-0.15, 51.55],
            [-0.2, 51.6],
          ],
        },
      ],
      [
        { id: "A", name: "Alpha", coordinates: [-0.1, 51.5] },
        { id: "B", name: "Beta", coordinates: [-0.15, 51.55] },
        { id: "C", name: "Gamma", coordinates: [-0.2, 51.6] },
      ],
      150,
    );

    expect(train?.coordinates[0]).toBeCloseTo(-0.15);
    expect(train?.coordinates[1]).toBeCloseTo(51.55);
  });

  it("keeps a train at its station during a dwell action", () => {
    const actions: TrainActions = {
      central: {
        "train-2": [
          {
            from_stop_id: "A",
            from_timestamp: 100,
            to_stop_id: "A",
            to_timestamp: 140,
          },
        ],
      },
    };

    expect(
      getTrainPositions(actions, [], [{ id: "A", name: "Alpha", coordinates: [-0.1, 51.5] }], 120),
    ).toMatchObject([{ coordinates: [-0.1, 51.5], fromStationId: "A", toStationId: "A" }]);
  });

  it("does not keep rendering completed train actions at their destination", () => {
    const actions: TrainActions = {
      central: {
        "train-4": [
          {
            from_stop_id: "A",
            from_timestamp: 100,
            to_stop_id: "B",
            to_timestamp: 200,
          },
          {
            from_stop_id: "B",
            from_timestamp: 200,
            to_stop_id: "B",
            to_timestamp: 240,
          },
          {
            from_stop_id: "B",
            from_timestamp: 240,
            to_stop_id: "C",
            to_timestamp: 300,
          },
        ],
      },
    };
    const stations: TubeStation[] = [
      { id: "A", name: "Alpha", coordinates: [-0.1, 51.5] },
      { id: "B", name: "Beta", coordinates: [-0.2, 51.6] },
      { id: "C", name: "Gamma", coordinates: [-0.3, 51.7] },
    ];
    const segments: TrackSegment[] = [
      {
        lineId: "central",
        fromStationId: "A",
        toStationId: "B",
        path: [
          [-0.1, 51.5],
          [-0.2, 51.6],
        ],
      },
      {
        lineId: "central",
        fromStationId: "B",
        toStationId: "C",
        path: [
          [-0.2, 51.6],
          [-0.3, 51.7],
        ],
      },
    ];

    expect(getTrainPositions(actions, segments, stations, 220)).toMatchObject([
      { fromStationId: "B", toStationId: "B", coordinates: [-0.2, 51.6] },
    ]);
    expect(getTrainPositions(actions, segments, stations, 260)).toHaveLength(1);
    expect(getTrainPositions(actions, segments, stations, 300)).toEqual([]);
  });

  it("does not invent a position when a train has no matching track geometry", () => {
    const actions: TrainActions = {
      central: {
        "train-3": [
          {
            from_stop_id: "A",
            from_timestamp: 100,
            to_stop_id: "B",
            to_timestamp: 200,
          },
        ],
      },
    };

    expect(getTrainPositions(actions, [], [], 150)).toEqual([]);
  });

  it("renders train hover details with progress and future London arrival times", () => {
    const train = {
      lineId: "central",
      trainId: "CEN005",
      coordinates: [-0.1, 51.5] as [number, number],
      fromStationId: "A",
      toStationId: "B",
      progressPercent: 92.1,
      futureStops: [{ stationName: "Marble Arch", arrivalTimestamp: 56_621 }],
    };

    const html = buildTrainTooltipHtml(
      train,
      new Map([
        ["A", "Lancaster Gate"],
        ["B", "Marble Arch"],
      ]),
      new Date("2026-10-20T15:00:00.000Z"),
    );

    expect(html).toContain("Central Train CEN005");
    expect(html).toContain("From:</strong> Lancaster Gate");
    expect(html).toContain("To:</strong> Marble Arch");
    expect(html).toContain("Progress:</strong> 92.1%");
    expect(html).toContain("Future Stops:");
    expect(html).toContain("15:43:41");
    expect(html).toContain("Marble Arch");
  });
});
