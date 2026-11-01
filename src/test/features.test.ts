import { afterEach, describe, expect, it, vi } from "vitest";
import { detectStatusChanges } from "@/components/LineAlerts";
import { journeyFromParams, journeyToParams, validateJourneyParams } from "@/lib/journey-search";
import { pushRecent, toggleInList } from "@/lib/storage";
import {
  buildJourneyUrl,
  crowdingLabel,
  disruptionsFromStatus,
  fetchJourneys,
  filterJourneysByAvoidedLines,
  formatFare,
  nearestStations,
  nextWeekendRange,
  type LineStatus,
  type Station,
} from "@/lib/tfl";

const status = (id: string, severity: number, description: string): LineStatus => ({
  id,
  name: id,
  lineStatuses: [{ statusSeverity: severity, statusSeverityDescription: description }],
});

describe("journey planner options", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds time, preference, accessibility and mode filters to the request", () => {
    const url = new URL(
      buildJourneyUrl("A", "B", {
        when: "2026-11-02T08:30",
        timeIs: "Arriving",
        preference: "LeastInterchange",
        accessibility: "StepFreeToVehicle",
        modes: ["tube", "dlr"],
      }),
    );
    expect(url.searchParams.get("date")).toBe("20261102");
    expect(url.searchParams.get("time")).toBe("0830");
    expect(url.searchParams.get("timeIs")).toBe("Arriving");
    expect(url.searchParams.get("journeyPreference")).toBe("LeastInterchange");
    expect(url.searchParams.get("accessibilityPreference")).toBe("StepFreeToVehicle");
    expect(url.searchParams.get("mode")).toBe("tube,dlr");
  });

  it("drops journeys that use an avoided line", () => {
    const journeys = [
      { duration: 10, legs: [{ line: { id: "central" } }] },
      { duration: 12, legs: [{ line: { id: "victoria" } }] },
    ];
    expect(filterJourneysByAvoidedLines(journeys, ["central"])).toEqual([journeys[1]]);
  });

  it("resolves ambiguous places using the best match", async () => {
    const journeys = [{ duration: 5 }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 300,
        json: async () => ({
          toLocationDisambiguation: {
            disambiguationOptions: [
              { parameterValue: "weak", matchQuality: 10 },
              { parameterValue: "strong", matchQuality: 90 },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ journeys }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJourneys("SW1A 1AA", "Bank")).resolves.toEqual(journeys);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("/to/strong?");
  });

  it("formats fares from pence", () => {
    expect(formatFare(280)).toBe("£2.80");
    expect(formatFare(undefined)).toBeNull();
  });
});

describe("shareable journey links", () => {
  it("round-trips a journey through URL params", () => {
    const search = {
      from: "940GZZLUBXN",
      to: "940GZZLUWLO",
      fromLabel: "Brixton",
      toLabel: "Waterloo",
      options: {
        when: "2026-11-02T08:30",
        timeIs: "Arriving" as const,
        preference: "LeastTime" as const,
        modes: ["tube"],
        avoidLines: ["northern"],
      },
    };
    const restored = journeyFromParams(validateJourneyParams({ ...journeyToParams(search) }));
    expect(restored).toMatchObject({ from: "940GZZLUBXN", toLabel: "Waterloo" });
    expect(restored?.options).toMatchObject({
      when: "2026-11-02T08:30",
      timeIs: "Arriving",
      preference: "LeastTime",
      modes: ["tube"],
      avoidLines: ["northern"],
    });
  });

  it("ignores invalid params", () => {
    const params = validateJourneyParams({ from: "A", pref: "Nope", when: "tomorrow", timeIs: 4 });
    expect(params.pref).toBeUndefined();
    expect(params.when).toBeUndefined();
    expect(journeyFromParams(params)).toBeNull();
  });
});

describe("favourites and recents", () => {
  it("toggles and caps lists", () => {
    const same = (a: number, b: number) => a === b;
    expect(toggleInList([1, 2], 2, same)).toEqual([1]);
    expect(toggleInList([1], 2, same)).toEqual([1, 2]);
    expect(pushRecent([1, 2, 3], 3, same, 3)).toEqual([3, 1, 2]);
    expect(pushRecent([1, 2, 3], 4, same, 3)).toEqual([4, 1, 2]);
  });
});

describe("nearest stations", () => {
  it("orders stations by distance", () => {
    const stations = [
      { id: "far", name: "Far", lat: 51.6, lon: -0.1, lines: [], stopIds: [] },
      { id: "near", name: "Near", lat: 51.5, lon: -0.12, lines: [], stopIds: [] },
    ] as Station[];
    expect(nearestStations(stations, 51.5001, -0.12, 1)[0]?.id).toBe("near");
  });
});

describe("disruptions and alerts", () => {
  it("extracts disrupted lines and crowding labels", () => {
    const lines = [status("central", 10, "Good Service"), status("jubilee", 6, "Severe Delays")];
    expect(disruptionsFromStatus(lines).map((item) => item.lineId)).toEqual(["jubilee"]);
    expect(crowdingLabel(0.2).label).toBe("Quiet");
    expect(crowdingLabel(0.9).label).toBe("Very busy");
  });

  it("only alerts for watched lines whose status changed", () => {
    const lines = [status("central", 6, "Severe Delays"), status("jubilee", 6, "Severe Delays")];
    const { alerts, next } = detectStatusChanges(
      { central: "Good Service", jubilee: "Good Service" },
      lines,
      ["central"],
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.title).toContain("Severe Delays");
    expect(next["jubilee"]).toBe("Severe Delays");
    expect(detectStatusChanges({}, lines, ["central"]).alerts).toHaveLength(0);
  });

  it("covers the upcoming weekend", () => {
    expect(nextWeekendRange(new Date(2026, 10, 4))).toEqual({
      from: "2026-11-07",
      to: "2026-11-08",
    });
    expect(nextWeekendRange(new Date(2026, 10, 8))).toEqual({
      from: "2026-11-08",
      to: "2026-11-08",
    });
  });
});
