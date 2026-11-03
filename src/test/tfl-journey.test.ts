import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJourneys } from "@/lib/tfl";

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
});
