import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJourneys, searchBusStops } from "@/lib/tfl";

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
          { id: "490000173RC", name: "Oxford Circus Station", towards: "Marble Arch" },
          { name: "Missing stop ID" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchBusStops("Oxford Circus")).resolves.toEqual([
      { id: "490000173RC", name: "Oxford Circus Station — towards Marble Arch" },
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
});
