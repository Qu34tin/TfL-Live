import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchBusLineStatuses,
  fetchNearbyBusArrivals,
  fetchJourneys,
  fetchNearbyBusStops,
  searchBusStops,
} from "@/lib/tfl";

describe("TfL journey planner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests journey options for the entered locations", async () => {
    const journeys = [{ duration: 24, legs: [] }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ journeys }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJourneys("King's Cross", "Canary Wharf")).resolves.toEqual(journeys);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tfl.gov.uk/Journey/JourneyResults/King's%20Cross/to/Canary%20Wharf?mode=tube%2Cdlr%2Coverground%2Celizabeth-line%2Ctram%2Cbus%2Ccable-car%2Cnational-rail",
    );
  });

  it("surfaces API errors instead of returning an empty journey list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(fetchJourneys("Waterloo", "Canary Wharf")).rejects.toThrow(
      "Journey planner unavailable (503)",
    );
  });

  it("searches TfL for bus stop suggestions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        matches: [
          {
            id: "490000173RC",
            icsId: "1002520",
            name: "Oxford Circus Station",
            lat: 51.51462,
            lon: -0.14194,
          },
          { id: "490000173RG", icsId: "1002520", name: "Oxford Circus Station" },
          { name: "Missing stop ID" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchBusStops("Oxford Circus")).resolves.toEqual([
      { id: "1002520", name: "Oxford Circus Station", lat: 51.51462, lon: -0.14194 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tfl.gov.uk/StopPoint/Search/Oxford%20Circus?modes=bus&maxResults=8",
    );
  });

  it("surfaces bus stop search errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(searchBusStops("Oxford Circus")).rejects.toThrow(
      "Bus stop search unavailable (503)",
    );
  });

  it("loads and normalizes nearby bus stops", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stopPoints: [
          {
            naptanId: "490000075F",
            commonName: "Embankment Station",
            lat: 51.50886,
            lon: -0.12042,
            lines: [{ id: "15" }, { id: "15" }, { name: "Missing route ID" }],
          },
          { naptanId: "missing-coordinates", commonName: "Unknown" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const expectedStops = [
      {
        id: "490000075F",
        name: "Embankment Station",
        lat: 51.50886,
        lon: -0.12042,
        lines: ["15"],
      },
    ];
    await expect(fetchNearbyBusStops(51.5, -0.12, 750)).resolves.toEqual(expectedStops);
    await expect(fetchNearbyBusStops(51.5, -0.12, 750)).resolves.toEqual(expectedStops);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tfl.gov.uk/StopPoint?lat=51.5&lon=-0.12&stopTypes=NaptanPublicBusCoachTram&radius=750",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads status for unique bus route IDs", async () => {
    const statuses = [{ id: "12", name: "12", lineStatuses: [] }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => statuses,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBusLineStatuses(["12", "12"])).resolves.toEqual(statuses);
    expect(fetchMock).toHaveBeenCalledWith("https://api.tfl.gov.uk/Line/12/Status");
    await expect(fetchBusLineStatuses([])).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates nearby live buses and uses the closest stop prediction", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: "arrival-a",
            lineId: "12",
            lineName: "12",
            platformName: "A",
            towards: "Oxford Circus",
            destinationName: "Oxford Circus",
            timeToStation: 120,
            vehicleId: "bus-1",
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: "arrival-b",
            lineId: "12",
            lineName: "12",
            platformName: "B",
            towards: "Oxford Circus",
            destinationName: "Oxford Circus",
            timeToStation: 60,
            vehicleId: "bus-1",
          },
          {
            id: "arrival-c",
            lineId: "88",
            lineName: "88",
            platformName: "C",
            towards: "Clapham",
            destinationName: "Clapham",
            timeToStation: 180,
          },
        ],
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchNearbyBusArrivals([
        { id: "stop-a", name: "Stop A", lat: 51.5, lon: -0.12, lines: [] },
        { id: "stop-b", name: "Stop B", lat: 51.51, lon: -0.13, lines: [] },
      ]),
    ).resolves.toMatchObject([
      { vehicleId: "bus-1", stopId: "stop-b", timeToStation: 60, lat: 51.51, lon: -0.13 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
