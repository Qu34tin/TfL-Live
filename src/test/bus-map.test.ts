import { describe, expect, it, vi } from "vitest";
import {
  fetchBusLines,
  getBusPositions,
  parseBusRouteSequence,
  snapBusPositionsToPaths,
  type BusArrival,
  type BusPosition,
} from "@/lib/bus-map";

describe("bus map data", () => {
  it("loads and naturally sorts the full TfL bus route catalogue", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { id: "N15", name: "N15" },
        { id: "100", name: "100" },
        { id: "9", name: "9" },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(fetchBusLines()).resolves.toEqual([
        { id: "9", name: "9" },
        { id: "100", name: "100" },
        { id: "N15", name: "N15" },
      ]);
      expect(fetchMock).toHaveBeenCalledWith("https://api.tfl.gov.uk/Line/Mode/bus");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("parses TfL route geometry and ordered stops", () => {
    const route = parseBusRouteSequence({
      lineStrings: ["[[[-0.1,51.5],[-0.11,51.51]]]"],
      stopPointSequences: [
        {
          stopPoint: [
            { id: "A", name: "First stop", lat: 51.5, lon: -0.1 },
            { id: "B", name: "Second stop", lat: 51.51, lon: -0.11 },
          ],
        },
      ],
    });

    expect(route.stops.map((stop) => stop.name)).toEqual(["First stop", "Second stop"]);
    expect(route.paths).toEqual([
      [
        [-0.1, 51.5],
        [-0.11, 51.51],
      ],
    ]);
  });

  it("keeps one predicted position per bus in the selected direction", () => {
    const stops = [
      { id: "A", name: "First stop", lat: 51.5, lon: -0.1 },
      { id: "B", name: "Second stop", lat: 51.501, lon: -0.101 },
      { id: "C", name: "Third stop", lat: 51.502, lon: -0.102 },
    ];
    const arrivals: BusArrival[] = [
      {
        id: "prediction-later",
        vehicleId: "BUS1",
        lineId: "11",
        direction: "outbound",
        naptanId: "C",
        stationName: "Third stop",
        destinationName: "Terminus",
        timeToStation: 120,
      },
      {
        id: "prediction-sooner",
        vehicleId: "BUS1",
        lineId: "11",
        direction: "outbound",
        naptanId: "B",
        stationName: "Second stop",
        destinationName: "Terminus",
        timeToStation: 60,
      },
      {
        id: "opposite-direction",
        vehicleId: "BUS2",
        lineId: "11",
        direction: "inbound",
        naptanId: "B",
        stationName: "Second stop",
        destinationName: "Other terminus",
        timeToStation: 30,
      },
    ];

    expect(getBusPositions(arrivals, stops, "outbound")).toEqual([
      expect.objectContaining({ vehicleId: "BUS1", nextStop: "Second stop", timeToStation: 60 }),
    ]);
  });

  it("advances predicted bus positions smoothly between feed refreshes", () => {
    const stops = [
      { id: "A", name: "First stop", lat: 51.5, lon: -0.1 },
      { id: "B", name: "Second stop", lat: 51.501, lon: -0.101 },
    ];
    const arrivals: BusArrival[] = [
      {
        id: "prediction",
        vehicleId: "BUS1",
        lineId: "11",
        direction: "outbound",
        naptanId: "B",
        stationName: "Second stop",
        destinationName: "Terminus",
        timeToStation: 30,
      },
      {
        id: "inbound-prediction",
        vehicleId: "BUS2",
        lineId: "11",
        direction: "inbound",
        naptanId: "B",
        stationName: "Second stop",
        destinationName: "Other terminus",
        timeToStation: 30,
      },
    ];
    const initialPosition = getBusPositions(arrivals, stops, "outbound")[0]!;
    const laterPosition = getBusPositions(arrivals, stops, "outbound", 5)[0]!;
    const inboundPosition = getBusPositions(arrivals, stops, "inbound")[0]!;

    expect(laterPosition.coordinates[0]).toBeLessThan(initialPosition.coordinates[0]);
    expect(laterPosition.timeToStation).toBe(25);
    expect(inboundPosition.direction).toBe("inbound");
  });

  it("snaps predicted bus positions onto the route street geometry", () => {
    const position: BusPosition = {
      vehicleId: "BUS1",
      direction: "outbound",
      coordinates: [-0.1051, 51.505],
      nextStop: "Next stop",
      destination: "Terminus",
      timeToStation: 30,
    };
    const paths: [number, number][][] = [
      [
        [-0.1, 51.5],
        [-0.11, 51.51],
      ],
    ];

    const [snapped] = snapBusPositionsToPaths([position], paths);

    expect(snapped?.coordinates[0]).toBeCloseTo(-0.105, 4);
    expect(snapped?.coordinates[1]).toBeCloseTo(51.505, 4);
  });
});
