import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Accessibility,
  AlertCircle,
  ArrowRight,
  ArrowUpDown,
  Check,
  Clock3,
  Info,
  LoaderCircle,
  LocateFixed,
  Map as MapIcon,
  Route as RouteIcon,
  Share2,
  Star,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildJourneyRoute, saveJourneyRoute } from "@/lib/journey-route";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { Segmented } from "@/components/Segmented";
import { WhenPicker } from "@/components/WhenPicker";
import {
  type AccessibilityPreference,
  cleanName,
  crowdingLabel,
  disruptionsFromStatus,
  fetchAllStations,
  fetchArrivals,
  fetchJourneys,
  fetchLineStatus,
  fetchStationArrivals,
  fetchStationAccessibility,
  fetchStationCrowding,
  formatFare,
  type Journey,
  JOURNEY_MODES,
  type JourneyPreference,
  LINE_COLOURS,
  minutes,
  nearestStations,
  OVERGROUND_LINE_IDS,
  type Station,
  STATIONS,
  TUBE_LINES,
} from "@/lib/tfl";
import {
  journeyFromParams,
  journeyToParams,
  type JourneySearch,
  validateJourneyParams,
} from "@/lib/journey-search";
import {
  pushRecent,
  type RecentJourney,
  type SavedStation,
  sameJourney,
  sameStation,
  STORAGE_KEYS,
  toggleInList,
  useStoredState,
} from "@/lib/storage";

type Stop = { id: string; name: string; stopIds?: string[] };
type JourneyLocation = { query: string; stationId?: string };

export const Route = createFileRoute("/boards")({
  validateSearch: validateJourneyParams,
  head: () => ({
    meta: [
      { title: "Live Departure Boards — London Underground Live" },
      {
        name: "description",
        content: "Plan London journeys and search stations for live departures.",
      },
      { property: "og:title", content: "Live Tube Departure Boards" },
      {
        property: "og:description",
        content: "Real-time departure boards for Tube and Elizabeth line stations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Boards,
});

function Boards() {
  const [stop, setStop] = useState<Stop>(
    STATIONS.find((station) => !station.name.endsWith("(Elizabeth line)")) ?? STATIONS[0]!,
  );
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [journeyFrom, setJourneyFrom] = useState<JourneyLocation>({ query: "" });
  const [journeyTo, setJourneyTo] = useState<JourneyLocation>({ query: "" });
  const [when, setWhen] = useState("");
  const [timeIs, setTimeIs] = useState<"Departing" | "Arriving">("Departing");
  const [preference, setPreference] = useState<JourneyPreference | "">("");
  const [accessibility, setAccessibility] = useState<AccessibilityPreference | "">("");
  const [modes, setModes] = useState<string[]>(JOURNEY_MODES.map((mode) => mode.id));
  const [avoidLines, setAvoidLines] = useState<string[]>([]);
  const [journeySearch, setJourneySearch] = useState<JourneySearch | null>(null);
  const [copied, setCopied] = useState(false);
  const [nearby, setNearby] = useState<(Station & { distance: number })[] | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const navigate = useNavigate({ from: "/boards" });
  const urlParams = Route.useSearch();
  const [favourites, setFavourites] = useStoredState<SavedStation[]>(
    STORAGE_KEYS.favouriteStations,
    [],
  );
  const [recentStations, setRecentStations] = useStoredState<SavedStation[]>(
    STORAGE_KEYS.recentStations,
    [],
  );
  const [recentJourneys, setRecentJourneys] = useStoredState<RecentJourney[]>(
    STORAGE_KEYS.recentJourneys,
    [],
  );

  const { data: allStations } = useQuery({
    queryKey: ["stations"],
    queryFn: fetchAllStations,
    staleTime: Infinity,
  });
  const {
    data: journeys,
    isFetching: journeysLoading,
    error: journeysError,
  } = useQuery({
    queryKey: ["journeys", journeySearch],
    queryFn: () => {
      if (!journeySearch) throw new Error("Choose a start and destination.");
      return fetchJourneys(journeySearch.from, journeySearch.to, journeySearch.options);
    },
    enabled: journeySearch !== null,
  });
  const { data: lineStatus } = useQuery({
    queryKey: ["status"],
    queryFn: fetchLineStatus,
    refetchInterval: 30_000,
  });
  const disruptions = useMemo(() => disruptionsFromStatus(lineStatus ?? []), [lineStatus]);

  const applySearch = (search: JourneySearch) => {
    const { options } = search;
    setJourneyFrom({ query: search.fromLabel, stationId: search.from });
    setJourneyTo({ query: search.toLabel, stationId: search.to });
    setWhen(options.when ?? "");
    setTimeIs(options.timeIs ?? "Departing");
    setPreference(options.preference ?? "");
    setAccessibility(options.accessibility ?? "");
    setModes(options.modes?.length ? options.modes : JOURNEY_MODES.map((mode) => mode.id));
    setAvoidLines(options.avoidLines ?? []);
    setJourneySearch(search);
  };

  // Restore a shared journey link once on load.
  useEffect(() => {
    const shared = journeyFromParams(urlParams);
    if (shared) applySearch(shared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = () => {
    const from = journeyFrom.stationId ?? journeyFrom.query.trim();
    const to = journeyTo.stationId ?? journeyTo.query.trim();
    if (!from || !to) return;
    const allModesSelected = modes.length === JOURNEY_MODES.length;
    const search: JourneySearch = {
      from,
      to,
      fromLabel: journeyFrom.query.trim(),
      toLabel: journeyTo.query.trim(),
      options: {
        when: when || undefined,
        timeIs,
        preference: preference || undefined,
        accessibility: accessibility || undefined,
        modes: allModesSelected || modes.length === 0 ? undefined : modes,
        avoidLines,
      },
    };
    setJourneySearch(search);
    setRecentJourneys((current) =>
      pushRecent(
        current,
        { from, to, fromName: search.fromLabel, toName: search.toLabel },
        sameJourney,
      ),
    );
    void navigate({ search: journeyToParams(search), replace: true });
  };

  const swapLocations = () => {
    setJourneyFrom(journeyTo);
    setJourneyTo(journeyFrom);
  };

  const shareJourney = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const locate = (onFound: (lat: number, lon: number) => void) => {
    if (!navigator.geolocation) {
      setLocationError("Location is not supported by this browser.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onFound(position.coords.latitude, position.coords.longitude);
      },
      () => {
        setLocating(false);
        setLocationError("Location permission was denied or unavailable.");
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  };

  const findNearby = () =>
    locate((lat, lon) => setNearby(nearestStations(allStations ?? [], lat, lon, 5)));
  const useMyLocation = (setLocation: (location: JourneyLocation) => void) =>
    locate((lat, lon) =>
      setLocation({ query: "My location", stationId: `${lat.toFixed(5)},${lon.toFixed(5)}` }),
    );
  const overgroundSet = new Set<string>(OVERGROUND_LINE_IDS);
  const counts = useMemo(() => {
    if (!allStations) return { tube: 0, elizabeth: 0, overground: 0, dlr: 0 };
    return {
      tube: allStations.filter((station) => station.lines.some((line) => TUBE_LINES.includes(line)))
        .length,
      elizabeth: allStations.filter((station) => station.lines.includes("elizabeth")).length,
      overground: allStations.filter((s) => s.lines.some((l) => overgroundSet.has(l))).length,
      dlr: allStations.filter((s) => s.lines.includes("dlr")).length,
    };
  }, [allStations]);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || !allStations) return [];
    return allStations
      .filter((s) => s.name.toLowerCase().includes(t))
      .sort(
        (a, b) =>
          Number(!a.name.toLowerCase().startsWith(t)) - Number(!b.name.toLowerCase().startsWith(t)),
      )
      .slice(0, 8);
  }, [q, allStations]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["arrivals", stop.id, stop.stopIds],
    queryFn: () =>
      stop.stopIds?.length ? fetchStationArrivals(stop.stopIds) : fetchArrivals(stop.id),
    refetchInterval: 20_000,
  });

  const {
    data: accessibilityItems,
    isLoading: accessibilityLoading,
    error: accessibilityError,
  } = useQuery({
    queryKey: ["station-accessibility", stop.id],
    queryFn: () => fetchStationAccessibility(stop.id),
    staleTime: 5 * 60_000,
  });

  const platforms = new Map<string, NonNullable<typeof data>>();
  data?.forEach((a) => {
    const key = `${a.lineId}|${a.platformName}`;
    const list = platforms.get(key) ?? [];
    if (list.length < 4) list.push(a);
    platforms.set(key, list);
  });

  const pick = (s: Stop) => {
    setStop(s);
    setQ("");
    setOpen(false);
    setRecentStations((current) => pushRecent(current, { id: s.id, name: s.name }, sameStation));
  };

  const stopStation = useMemo(
    () =>
      allStations?.find(
        (station) => station.id === stop.id || station.name === cleanName(stop.name),
      ),
    [allStations, stop.id, stop.name],
  );
  const crowdingStopId =
    stopStation?.stopIds.find((id) => id.startsWith("940G")) ??
    (stop.id.startsWith("940G") ? stop.id : undefined);
  const { data: crowding } = useQuery({
    queryKey: ["crowding", crowdingStopId],
    queryFn: () => fetchStationCrowding(crowdingStopId ?? ""),
    enabled: Boolean(crowdingStopId),
    refetchInterval: 5 * 60_000,
  });
  const stopLines = new Set(stopStation?.lines ?? []);
  const stationDisruptions = disruptions.filter((item) => stopLines.has(item.lineId));
  const isFavourite = favourites.some((item) => item.id === stop.id);
  const toggleFavourite = () =>
    setFavourites((current) =>
      toggleInList(current, { id: stop.id, name: cleanName(stop.name) }, sameStation),
    );
  const pickSaved = (saved: SavedStation) =>
    pick(allStations?.find((station) => station.id === saved.id) ?? saved);

  const chipStations = useMemo(() => {
    if (!allStations) return [];
    const seen = new Set<string>();
    const stationsByName = new Map(allStations.map((station) => [station.name, station]));
    return STATIONS.flatMap((station) => {
      const mergedStation = stationsByName.get(cleanName(station.name));
      if (!mergedStation || seen.has(mergedStation.name)) return [];
      seen.add(mergedStation.name);
      return [mergedStation];
    });
  }, [allStations]);

  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-6xl px-5 py-14">
        <h1 className="font-display text-4xl font-extrabold tracking-tight md:text-5xl">
          Departure boards
        </h1>
        <p className="mt-3 text-muted-foreground">
          Search any of{" "}
          {allStations
            ? `${counts.tube} Tube stations, ${counts.elizabeth} Elizabeth line stations, ${counts.overground} Overground stations, ${counts.dlr} DLR stations.`
            : "270+ stations."}{" "}
          Boards refresh every 20 seconds.
        </p>

        <section
          aria-labelledby="journey-planner-heading"
          className="relative mt-8 overflow-visible rounded-2xl border border-border bg-card shadow-sm"
        >
          <div className="flex items-start gap-3 rounded-t-2xl border-b border-border bg-secondary/40 px-4 py-4 sm:px-5">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <RouteIcon size={18} aria-hidden="true" />
            </span>
            <div>
              <h2 id="journey-planner-heading" className="font-display text-lg font-bold">
                Journey planner
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Get route options across London’s transport network.
              </p>
            </div>
          </div>
          <div className="p-4 sm:p-5">
            <form
              className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                runSearch();
              }}
            >
              <JourneyStationPicker
                id="journey-from"
                label="From"
                location={journeyFrom}
                onChange={setJourneyFrom}
                onUseLocation={() => useMyLocation(setJourneyFrom)}
                stations={allStations ?? []}
              />
              <button
                type="button"
                onClick={swapLocations}
                aria-label="Swap start and destination"
                title="Swap start and destination"
                className="inline-flex h-11 w-11 items-center justify-center justify-self-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <ArrowUpDown size={16} className="sm:rotate-90" aria-hidden="true" />
              </button>
              <JourneyStationPicker
                id="journey-to"
                label="To"
                location={journeyTo}
                onChange={setJourneyTo}
                onUseLocation={() => useMyLocation(setJourneyTo)}
                stations={allStations ?? []}
              />
              <button
                type="submit"
                disabled={journeysLoading}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
              >
                {journeysLoading ? (
                  <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowRight size={16} aria-hidden="true" />
                )}
                Plan journey
              </button>

              <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
                <Segmented
                  label="Leaving or arriving"
                  value={timeIs}
                  onChange={setTimeIs}
                  options={[
                    { value: "Departing", label: "Leave at" },
                    { value: "Arriving", label: "Arrive by" },
                  ]}
                />
                <WhenPicker value={when} onChange={setWhen} />
                <button
                  type="button"
                  onClick={() => setWhen("")}
                  disabled={!when}
                  className="rounded-full border border-border px-4 py-1.5 text-sm transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  Now
                </button>
                {locationError && (
                  <p className="text-sm text-destructive" role="alert">
                    {locationError}
                  </p>
                )}
              </div>

              <details className="rounded-xl border border-border bg-background/60 px-4 py-3 sm:col-span-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Route preferences, step-free and lines to avoid
                </summary>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5 text-sm font-medium">
                    <p>Route preference</p>
                    <Segmented<JourneyPreference | "">
                      label="Route preference"
                      size="sm"
                      value={preference}
                      onChange={setPreference}
                      options={[
                        { value: "", label: "Recommended" },
                        { value: "LeastTime", label: "Fastest" },
                        { value: "LeastInterchange", label: "Fewest changes" },
                        { value: "LeastWalking", label: "Least walking" },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5 text-sm font-medium">
                    <p>Accessibility</p>
                    <Segmented<AccessibilityPreference | "">
                      label="Accessibility"
                      size="sm"
                      value={accessibility}
                      onChange={setAccessibility}
                      options={[
                        { value: "", label: "None" },
                        { value: "StepFreeToVehicle", label: "Step-free to train" },
                        { value: "StepFreeToPlatform", label: "Step-free to platform" },
                        { value: "NoSolidStairs", label: "No stairs" },
                        { value: "NoEscalators", label: "No escalators" },
                        { value: "NoElevators", label: "No lifts" },
                      ]}
                    />
                  </div>
                  <fieldset className="md:col-span-2">
                    <legend className="text-sm font-medium">Travel by</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {JOURNEY_MODES.map((mode) => (
                        <ToggleChip
                          key={mode.id}
                          label={mode.label}
                          checked={modes.includes(mode.id)}
                          onChange={() =>
                            setModes((current) => toggleInList(current, mode.id, (a, b) => a === b))
                          }
                        />
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="md:col-span-2">
                    <legend className="text-sm font-medium">Avoid lines</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[...TUBE_LINES, "elizabeth", "dlr", ...OVERGROUND_LINE_IDS].map((lineId) => (
                        <ToggleChip
                          key={lineId}
                          label={lineId.replace(/-/g, " ")}
                          color={LINE_COLOURS[lineId]}
                          checked={avoidLines.includes(lineId)}
                          onChange={() =>
                            setAvoidLines((current) =>
                              toggleInList(current, lineId, (a, b) => a === b),
                            )
                          }
                        />
                      ))}
                    </div>
                  </fieldset>
                </div>
              </details>
            </form>

            {recentJourneys.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Recent journeys
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {recentJourneys.map((recent) => (
                    <button
                      key={`${recent.from}>${recent.to}`}
                      type="button"
                      onClick={() => {
                        setJourneyFrom({ query: recent.fromName, stationId: recent.from });
                        setJourneyTo({ query: recent.toName, stationId: recent.to });
                      }}
                      className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {recent.fromName} → {recent.toName}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {journeysError && (
              <p className="mt-4 flex items-start gap-2 text-sm text-destructive" role="alert">
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                Journey options could not be loaded. Check the locations and try again.
              </p>
            )}
            {journeySearch && !journeysLoading && !journeysError && journeys?.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground" role="status">
                No journeys found. Try a nearby station, postcode or fewer restrictions.
              </p>
            )}
            {journeysLoading && (
              <p
                className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                Finding live journey options…
              </p>
            )}
            {journeys && journeys.length > 0 && journeySearch && (
              <>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={shareJourney}
                    className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:bg-secondary"
                  >
                    {copied ? (
                      <Check size={14} aria-hidden="true" />
                    ) : (
                      <Share2 size={14} aria-hidden="true" />
                    )}
                    {copied ? "Link copied" : "Share journey"}
                  </button>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {journeys.slice(0, 4).map((journey, index) => (
                    <JourneyOption
                      key={`${journey.startDateTime}-${index}`}
                      journey={journey}
                      from={journeySearch.fromLabel}
                      to={journeySearch.toLabel}
                      disruptedLineIds={new Set(disruptions.map((item) => item.lineId))}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <div className="relative mt-8 max-w-xl">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) pick(results[0]);
            }}
            placeholder="Search a station, e.g. Brixton"
            aria-label="Search a station"
            className="w-full rounded-full border border-border bg-card px-5 py-3 text-base outline-none placeholder:text-muted-foreground focus:border-primary"
          />
          {open && results.length > 0 && (
            <ul className="absolute z-10 mt-2 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
              {results.map((s) => (
                <li key={s.id}>
                  <button
                    onMouseDown={() => pick(s)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left hover:bg-secondary"
                  >
                    <span>{s.name}</span>
                    <span className="flex gap-1">
                      {s.lines.map((l) => (
                        <span
                          key={l}
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: LINE_COLOURS[l] }}
                        />
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {open && q.trim() && allStations && results.length === 0 && (
            <p className="absolute mt-2 px-5 text-sm text-muted-foreground">
              No station matches "{q}".
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={findNearby}
            disabled={locating || !allStations}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
          >
            {locating ? (
              <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
            ) : (
              <LocateFixed size={12} aria-hidden="true" />
            )}
            Stations near me
          </button>
          {chipStations.slice(0, 6).map((s) => (
            <button
              key={s.id}
              onClick={() => pick(s)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                s.id === stop.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {cleanName(s.name)}
            </button>
          ))}
        </div>
        {locationError && !journeySearch && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {locationError}
          </p>
        )}
        {nearby && (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Nearest stations">
            {nearby.map((station) => (
              <button
                key={station.id}
                type="button"
                onClick={() => pick(station)}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {station.name} · {Math.round(station.distance)} m
              </button>
            ))}
          </div>
        )}
        {favourites.length > 0 && (
          <SavedChips title="Favourites" items={favourites} onPick={pickSaved} icon="star" />
        )}
        {recentStations.length > 0 && (
          <SavedChips title="Recent" items={recentStations} onPick={pickSaved} />
        )}

        <div className="mt-12 flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-bold">{stop.name}</h2>
          <button
            type="button"
            onClick={toggleFavourite}
            aria-pressed={isFavourite}
            aria-label={
              isFavourite ? `Remove ${stop.name} from favourites` : `Save ${stop.name} as favourite`
            }
            className="rounded-full border border-border p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Star
              size={16}
              aria-hidden="true"
              className={isFavourite ? "fill-yellow-400 text-yellow-400" : ""}
            />
          </button>
          {crowding && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                crowdingLabel(crowding.percentageOfBaseline).tone === "good"
                  ? "bg-good/15 text-good"
                  : "bg-warn/15 text-warn"
              }`}
            >
              <Users size={12} aria-hidden="true" />
              {crowdingLabel(crowding.percentageOfBaseline).label} right now
            </span>
          )}
        </div>
        {stationDisruptions.length > 0 && (
          <ul className="mt-4 space-y-2" aria-label="Line disruptions at this station">
            {stationDisruptions.map((item) => (
              <li
                key={item.lineId}
                className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm"
              >
                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
                <span>
                  <strong>{item.lineName}:</strong> {item.status}
                  {item.reason && (
                    <span className="mt-0.5 block text-muted-foreground">{item.reason}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <section
          aria-labelledby="station-accessibility-heading"
          className="mt-5 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        >
          <div className="flex items-start gap-3 border-b border-border bg-secondary/40 px-4 py-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Accessibility size={18} aria-hidden="true" />
            </span>
            <div>
              <h3 id="station-accessibility-heading" className="font-display text-base font-bold">
                Station accessibility
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Facilities reported by TfL for {stop.name}
              </p>
            </div>
          </div>
          <div className="p-4">
            {accessibilityLoading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                Loading accessibility information…
              </p>
            )}
            {accessibilityError && (
              <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                Accessibility information could not be loaded. Please try again later.
              </p>
            )}
            {accessibilityItems && accessibilityItems.length > 0 && (
              <dl className="grid gap-2 sm:grid-cols-2">
                {accessibilityItems.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-border bg-background/70 px-3 py-2.5"
                  >
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {item.label}
                    </dt>
                    <dd className="mt-0.5 break-words text-sm font-semibold text-foreground">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {accessibilityItems?.length === 0 && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                TfL has not provided accessibility details for this station.
              </p>
            )}
          </div>
        </section>
        {error && <p className="mt-4 text-destructive">Couldn't load arrivals. Retrying…</p>}
        {isLoading && <div className="mt-6 h-48 animate-pulse rounded-xl bg-board" />}
        {data && data.length === 0 && (
          <p className="mt-4 text-muted-foreground">No trains due right now.</p>
        )}
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {[...platforms.entries()].map(([key, arrivals]) => (
            <section key={key} className="overflow-hidden rounded-xl border border-border bg-board">
              <div
                className="h-1.5"
                style={{ background: LINE_COLOURS[arrivals[0]!.lineId] ?? "var(--primary)" }}
              />
              <div className="p-5">
                <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
                  {arrivals[0]!.lineName} · {arrivals[0]!.platformName}
                </p>
                <ol className="space-y-2">
                  {arrivals.map((a, i) => (
                    <li
                      key={a.id}
                      className="led-text flex justify-between gap-4 text-sm md:text-base"
                    >
                      <span className="truncate">
                        {i + 1} {cleanName(a.towards || a.destinationName || "")}
                      </span>
                      <span className="shrink-0">{minutes(a.timeToStation)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function ToggleChip({
  label,
  checked,
  onChange,
  color,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  color?: string | undefined;
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs capitalize transition-colors focus-within:ring-2 focus-within:ring-primary ${
        checked
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-card text-muted-foreground"
      }`}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      {color && (
        <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" />
      )}
      {label}
    </label>
  );
}

function SavedChips({
  title,
  items,
  onPick,
  icon,
}: {
  title: string;
  items: SavedStation[];
  onPick: (station: SavedStation) => void;
  icon?: "star";
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPick(item)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {icon === "star" && (
            <Star size={11} className="fill-yellow-400 text-yellow-400" aria-hidden="true" />
          )}
          {cleanName(item.name)}
        </button>
      ))}
    </div>
  );
}

function JourneyOption({
  journey,
  from,
  to,
  disruptedLineIds,
}: {
  journey: Journey;
  from: string;
  to: string;
  disruptedLineIds: Set<string>;
}) {
  const arrivalTime = journey.arrivalDateTime
    ? new Date(journey.arrivalDateTime).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const fare = formatFare(journey.fare?.totalCost);
  const navigate = useNavigate();

  return (
    <article className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-lg font-bold">
          <Clock3 size={17} className="text-primary" aria-hidden="true" />
          {journey.duration} min
        </p>
        <p className="text-sm text-muted-foreground">
          {fare && <span className="mr-3 font-mono text-foreground">{fare}</span>}
          {arrivalTime && (
            <>
              Arrives <span className="font-mono text-foreground">{arrivalTime}</span>
            </>
          )}
        </p>
      </div>
      <ol className="mt-3 space-y-3 border-l border-border pl-4">
        {journey.legs?.map((leg, index) => {
          const modeName = leg.mode?.name ?? "Travel";
          const lineName = leg.line?.name ?? leg.routeOptions?.[0]?.name;
          const instruction =
            leg.instruction?.summary ??
            (lineName
              ? `Take ${lineName}`
              : `${modeName} to ${leg.arrivalPoint?.commonName ?? "destination"}`);
          const warning =
            leg.disruptions?.[0]?.description ??
            (leg.isDisrupted || (leg.line?.id && disruptedLineIds.has(leg.line.id))
              ? `${lineName ?? modeName} is currently disrupted`
              : undefined);
          return (
            <li key={`${leg.departureTime}-${index}`} className="relative text-sm">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
              <p className="font-medium">{instruction}</p>
              <p className="mt-0.5 text-muted-foreground">
                {leg.departurePoint?.commonName}
                {leg.departurePoint?.commonName && leg.arrivalPoint?.commonName ? " → " : ""}
                {leg.arrivalPoint?.commonName}
                {leg.duration !== undefined ? ` · ${leg.duration} min` : ""}
              </p>
              {warning && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-warn">
                  <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="line-clamp-3">{warning}</span>
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => {
            saveJourneyRoute(buildJourneyRoute(journey));
            void navigate({ to: "/map" });
          }}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <MapIcon size={15} aria-hidden="true" />
          Show on map
        </button>        <a
          href={`https://maps.apple.com/?saddr=${encodeURIComponent(from)}&daddr=${encodeURIComponent(to)}&dirflg=r`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open journey in Apple Maps"
          className="rounded-full border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-secondary"
        >
          <img
            src="/images/maps/apple-maps.svg"
            alt=""
            className="h-4 w-[53px] brightness-0 dark:invert"
          />
        </a>
        <a
          href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=transit`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open journey in Google Maps"
          className="rounded-full border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-secondary"
        >
          <span className="flex items-center gap-2">
            <img src="/images/maps/google-maps.png" alt="" className="h-5 w-5" />
            Google Maps
          </span>
        </a>
      </div>
    </article>
  );
}

function JourneyStationPicker({
  id,
  label,
  location,
  onChange,
  onUseLocation,
  stations,
}: {
  id: string;
  label: string;
  location: JourneyLocation;
  onChange: (location: JourneyLocation) => void;
  onUseLocation: () => void;
  stations: Station[];
}) {
  const [open, setOpen] = useState(false);
  const query = location.query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!query) return [];
    return stations
      .filter((station) => station.name.toLowerCase().includes(query))
      .sort(
        (a, b) =>
          Number(!a.name.toLowerCase().startsWith(query)) -
          Number(!b.name.toLowerCase().startsWith(query)),
      )
      .slice(0, 8);
  }, [query, stations]);

  const pick = (station: Station) => {
    onChange({ query: station.name, stationId: station.id });
    setOpen(false);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={containerRef} className={`relative ${open && results.length > 0 ? "z-20" : ""}`}>
      <label htmlFor={id} className="flex items-center justify-between text-sm font-medium">
        {label}
        <button
          type="button"
          onClick={onUseLocation}
          className="inline-flex items-center gap-1 text-xs font-normal text-primary hover:underline"
        >
          <LocateFixed size={11} aria-hidden="true" />
          My location
        </button>
      </label>
      <input
        id={id}
        required
        value={location.query}
        onChange={(event) => {
          onChange({ query: event.target.value });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Station, postcode or address"
        autoComplete="off"
        className="mt-1.5 w-full rounded-full border border-border bg-background px-5 py-3 text-base outline-none placeholder:text-muted-foreground focus:border-primary"
      />
      {open && results.length > 0 && (
        <ul className="absolute left-0 top-full z-30 mt-2 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
          {results.map((station) => (
            <li key={station.id}>
              <button
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => pick(station)}
                className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left hover:bg-secondary"
              >
                <span>{station.name}</span>
                <span className="flex gap-1">
                  {station.lines.map((line) => (
                    <span
                      key={line}
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: LINE_COLOURS[line] }}
                    />
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query && stations.length > 0 && results.length === 0 && (
        <p className="absolute z-10 mt-2 rounded-lg bg-popover px-5 py-2 text-sm text-muted-foreground shadow">
          No station matches "{location.query}". It will be searched as a place or postcode.
        </p>
      )}
    </div>
  );
}
