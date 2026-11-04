import { createFileRoute, ClientOnly, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, ListFilter, Search, TrainFront, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { clearJourneyRoute, loadJourneyRoute, type JourneyRoute } from "@/lib/journey-route";
import {
  disruptionsFromStatus,
  fetchAllStations,
  fetchLineStatus,
  LINE_COLOURS,
  OVERGROUND_LINE_IDS,
  type Station,
  TUBE_LINES,
} from "@/lib/tfl";

const TubeMap = lazy(() => import("@/components/TubeMap"));

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Map · TfL-Live" },
      {
        name: "description",
        content: "Watch London Tube and Overground trains move across a live 3D map.",
      },
      { property: "og:title", content: "Live 3D Tube Map" },
      {
        property: "og:description",
        content: "Live Tube and Overground trains on a 3D map of London.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MapPage,
});

function JourneyPanel({
  route,
  activeStep,
  onSelect,
  onClear,
}: {
  route: JourneyRoute;
  activeStep: number | null;
  onSelect: (step: number | null) => void;
  onClear: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const first = route.stops[0]?.name;
  const last = route.stops[route.stops.length - 1]?.name;
  const changes = Math.max(0, route.steps.filter((step) => !step.walking).length - 1);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const nextTrain = route.steps.find((step) => !step.walking && step.departureTime);
  const departure = nextTrain?.departureTime ? new Date(nextTrain.departureTime) : null;
  const minutesAway = departure
    ? Math.max(0, Math.round((departure.getTime() - now) / 60_000))
    : null;
  return (
    <section
      aria-label="Journey instructions"
      className="absolute bottom-10 left-3 right-16 z-20 flex max-h-[50%] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-[#192126] dark:text-neutral-100 sm:bottom-3 sm:right-auto sm:w-[22rem]"
    >
      <div className="flex items-start gap-2 px-3.5 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {first} <span className="text-neutral-400">→</span> {last}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
              {route.duration} min
            </span>
            {" · "}
            {changes === 0 ? "No changes" : `${changes} change${changes > 1 ? "s" : ""}`}
          </p>
          {departure && nextTrain && (
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              Next {nextTrain.label} departs{" "}
              <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                {departure.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </span>
              {minutesAway !== null && (minutesAway === 0 ? " · now" : ` · in ${minutesAway} min`)}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={collapsed ? "Show journey steps" : "Hide journey steps"}
          onClick={() => setCollapsed((value) => !value)}
          className="rounded-full p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <button
          type="button"
          aria-label="Clear journey"
          onClick={onClear}
          className="rounded-full p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex gap-1 px-3.5 pb-2.5" aria-hidden="true">
        {route.steps.map((step, index) => (
          <span
            key={index}
            className="h-1.5 rounded-full"
            style={{ background: step.colour, flexGrow: Math.max(step.minutes ?? 1, 1) }}
          />
        ))}
      </div>
      {!collapsed && (
        <ol className="min-h-0 flex-1 overflow-y-auto border-t border-neutral-200 py-1.5 dark:border-neutral-700">
          {route.steps.map((step, index) => {
            const active = activeStep === index;
            return (
              <li key={index}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(active ? null : index)}
                  className={`flex w-full items-start gap-3 px-3.5 py-2 text-left transition-colors ${active ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60"}`}
                >
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: step.colour }}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-xs">
                    <span className="block text-[13px] font-semibold leading-tight">
                      {step.instruction}
                    </span>
                    <span className="mt-0.5 block text-neutral-500 dark:text-neutral-400">
                      {step.from} → {step.to}
                    </span>
                  </span>
                  {step.minutes !== undefined && (
                    <span className="shrink-0 font-mono text-xs text-neutral-500 dark:text-neutral-400">
                      {step.minutes} min
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function MapPage() {
  const [overgroundEnabled, setOvergroundEnabled] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [stationsLoading, setStationsLoading] = useState(true);
  const [stationSearchError, setStationSearchError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showLines, setShowLines] = useState(false);
  const [hiddenLines, setHiddenLines] = useState<string[]>([]);
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [journeyRoute, setJourneyRoute] = useState<JourneyRoute | null>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  useEffect(() => {
    setJourneyRoute(loadJourneyRoute());
  }, []);
  const { data: lineStatus } = useQuery({
    queryKey: ["status"],
    queryFn: fetchLineStatus,
    refetchInterval: 30_000,
  });
  const disruptions = useMemo(() => disruptionsFromStatus(lineStatus ?? []), [lineStatus]);
  const mapLines = useMemo(
    () => [
      ...TUBE_LINES,
      "elizabeth",
      "dlr",
      "tram",
      ...(overgroundEnabled ? OVERGROUND_LINE_IDS : []),
    ],
    [overgroundEnabled],
  );

  useEffect(() => {
    let cancelled = false;
    fetchAllStations()
      .then((loadedStations) => {
        if (!cancelled) setStations(loadedStations);
      })
      .catch((error: unknown) => {
        console.error("Unable to load stations for map search", error);
        if (!cancelled)
          setStationSearchError("Station search is unavailable. Please try again later.");
      })
      .finally(() => {
        if (!cancelled) setStationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const suggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase().trim();
    return stations.filter((station) => station.name.toLowerCase().includes(query)).slice(0, 8);
  }, [searchQuery, stations]);

  const selectStation = (station: Station) => {
    setSearchQuery(station.name);
    setSelectedStation(station);
    setShowSuggestions(false);
  };

  return (
    <div className="flex h-dvh flex-col bg-background">
      <SiteHeader />
      <main
        id="main-content"
        aria-label="Live interactive London transport map. Open the Lines panel for a text alternative."
        className="relative mx-3 mb-2 min-h-0 flex-1 overflow-hidden rounded-xl border border-white/20 bg-[#f2f1eb] dark:border-neutral-700 dark:bg-[#111820] sm:mx-6"
      >
        {
          <div className="absolute left-24 right-3 top-3 z-20 sm:left-1/2 sm:right-auto sm:top-4 sm:-translate-x-1/2">
            <div className="relative">
              <div className="flex w-full items-center gap-2 rounded-full border border-white/80 bg-white/95 px-3 shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-[#192126]/95 sm:w-[22rem]">
                <Search size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                <label className="sr-only" htmlFor="map-station-search">
                  Search for a station
                </label>
                <input
                  id="map-station-search"
                  type="text"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showSuggestions && Boolean(searchQuery.trim())}
                  aria-controls="map-station-suggestions"
                  autoComplete="off"
                  value={searchQuery}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setShowSuggestions(false)}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSelectedStation(null);
                    setShowSuggestions(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setShowSuggestions(false);
                    if (event.key === "Enter" && suggestions[0]) {
                      event.preventDefault();
                      selectStation(suggestions[0]);
                    }
                  }}
                  placeholder="Search stations"
                  className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Clear station search"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedStation(null);
                      setShowSuggestions(false);
                    }}
                    className="rounded-full p-1 text-muted-foreground hover:bg-secondary"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
              {showSuggestions && searchQuery.trim() && (
                <ul
                  id="map-station-suggestions"
                  role="listbox"
                  className="absolute z-10 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-2xl"
                >
                  {suggestions.map((station) => (
                    <li
                      key={station.id}
                      role="option"
                      aria-selected={selectedStation?.id === station.id}
                    >
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectStation(station)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                      >
                        <span>{station.name}</span>
                        <span className="flex shrink-0 gap-1" aria-label={station.lines.join(", ")}>
                          {station.lines.slice(0, 4).map((line) => (
                            <span
                              key={line}
                              aria-hidden="true"
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: LINE_COLOURS[line] ?? "#888" }}
                            />
                          ))}
                        </span>
                      </button>
                    </li>
                  ))}
                  {suggestions.length === 0 && (
                    <li className="px-4 py-3 text-sm text-muted-foreground">
                      {stationsLoading
                        ? "Loading stations..."
                        : (stationSearchError ?? "No stations found.")}
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        }
        <ClientOnly
          fallback={
            <div className="absolute inset-0 animate-pulse bg-[#f2f1eb] dark:bg-[#111820]" />
          }
        >
          <Suspense
            fallback={
              <div className="absolute inset-0 animate-pulse bg-[#f2f1eb] dark:bg-[#111820]" />
            }
          >
            <TubeMap
              overgroundEnabled={overgroundEnabled}
              selectedStation={selectedStation}
              hiddenLines={hiddenLines}
              journeyRoute={journeyRoute}
              activeStep={activeStep}
            />
          </Suspense>
        </ClientOnly>
        {journeyRoute && (
          <JourneyPanel
            route={journeyRoute}
            activeStep={activeStep}
            onSelect={setActiveStep}
            onClear={() => {
              clearJourneyRoute();
              setJourneyRoute(null);
              setActiveStep(null);
            }}
          />
        )}
        {showLines && (
          <section
            id="map-lines-panel"
            aria-label="Lines, status and filters"
            className="absolute bottom-12 right-14 z-20 flex max-h-[55%] w-[min(17rem,calc(100vw-5rem))] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-[#192126] dark:text-neutral-100"
          >
            <div className="flex items-center gap-1.5 border-b border-neutral-200 px-2.5 py-1.5 dark:border-neutral-700">
              <h2 className="mr-auto font-display text-xs font-bold uppercase tracking-wider">
                Lines
                <span className="ml-1.5 font-mono font-normal normal-case tracking-normal text-neutral-500 dark:text-neutral-400">
                  {mapLines.length - hiddenLines.length}/{mapLines.length}
                </span>
              </h2>
              <button
                type="button"
                onClick={() => setHiddenLines([])}
                className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
              >
                All
              </button>
              <button
                type="button"
                onClick={() =>
                  setHiddenLines(
                    mapLines.filter((id) => {
                      const severity = lineStatus?.find((l) => l.id === id)?.lineStatuses[0]
                        ?.statusSeverity;
                      return severity === undefined || severity === 10;
                    }),
                  )
                }
                className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
              >
                Disrupted
              </button>
              <button
                type="button"
                aria-label="Close lines panel"
                onClick={() => setShowLines(false)}
                className="rounded-full p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              {mapLines.map((lineId) => {
                const status = lineStatus?.find((line) => line.id === lineId);
                const current = status?.lineStatuses[0];
                const severity = current?.statusSeverity ?? 10;
                const good = severity === 10;
                const visible = !hiddenLines.includes(lineId);
                const expanded = expandedLine === lineId;
                const tone = good
                  ? "bg-green-500"
                  : severity <= 6 || severity === 20
                    ? "bg-red-500"
                    : severity === 9 || severity === 8
                      ? "bg-amber-400"
                      : "bg-blue-500";
                const shortStatus = (current?.statusSeverityDescription ?? "")
                  .replace(" Delays", "")
                  .replace("Planned Closure", "Closure")
                  .replace("Part Closure", "Part closed");
                const colour = LINE_COLOURS[lineId] ?? "#888";
                const name = status?.name ?? lineId.replace(/-/g, " ");
                return (
                  <li key={lineId}>
                    <div className="flex items-center gap-2 px-2.5 py-[3px]">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={visible}
                        aria-label={`Show ${name} on map`}
                        onClick={() =>
                          setHiddenLines((existing) =>
                            existing.includes(lineId)
                              ? existing.filter((id) => id !== lineId)
                              : [...existing, lineId],
                          )
                        }
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        style={{
                          borderColor: colour,
                          background: visible ? colour : "transparent",
                        }}
                      >
                        {visible && (
                          <Check
                            size={11}
                            strokeWidth={3.5}
                            aria-hidden="true"
                            className="text-white drop-shadow-[0_0_1px_rgba(0,0,0,0.9)]"
                          />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={good || !current?.reason}
                        aria-expanded={expanded}
                        onClick={() => setExpandedLine(expanded ? null : lineId)}
                        className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-xs enabled:hover:text-neutral-600 enabled:dark:hover:text-neutral-300 ${visible ? "" : "opacity-45"}`}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                        {!good && (
                          <span className="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-400">
                            {shortStatus}
                          </span>
                        )}
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${tone}`}
                          title={current?.statusSeverityDescription ?? "Good Service"}
                          aria-label={current?.statusSeverityDescription ?? "Good Service"}
                        />
                      </button>
                    </div>
                    {expanded && current?.reason && (
                      <p className="mx-2.5 mb-1 rounded-lg bg-neutral-100 px-2 py-1.5 text-[11px] leading-snug text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                        {current.reason}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {
          <>
            <div className="pointer-events-none absolute left-3 top-3 flex h-10 items-center rounded-md border border-white/80 bg-white/90 px-3 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-[#192126]/95 sm:block sm:h-auto sm:py-1.5">
              <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-red-600">
                <span className="pulse-dot h-2 w-2 rounded-full bg-red-500" /> Live
              </p>
            </div>
            {!journeyRoute && (
              <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/80 bg-white/90 px-3 py-2 font-mono text-[10px] leading-relaxed text-neutral-700 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-[#192126]/95 dark:text-neutral-200">
                <p>Right-drag to orbit</p>
                <p>Zoom in for buildings</p>
                <p>Click a station for accessibility info</p>
              </div>
            )}
          </>
        }
        <div className="absolute bottom-12 right-3 z-20 flex flex-col items-center gap-2">
          {
            <button
              type="button"
              onClick={() => setShowLines((current) => !current)}
              aria-pressed={showLines}
              aria-expanded={showLines}
              aria-controls="map-lines-panel"
              aria-label="Lines, status and filters"
              className={`relative inline-flex h-11 w-11 items-center justify-center rounded-lg border shadow-lg backdrop-blur transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                showLines
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-white/80 bg-white/95 text-neutral-900 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-[#192126]/95 dark:text-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              <ListFilter size={18} aria-hidden="true" />
              {disruptions.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-black">
                  {disruptions.length}
                </span>
              )}
            </button>
          }
          {
            <button
              type="button"
              onClick={() => setOvergroundEnabled((current) => !current)}
              aria-pressed={overgroundEnabled}
              aria-label={
                overgroundEnabled ? "Hide London Overground lines" : "Show London Overground lines"
              }
              className={`group relative inline-flex h-11 w-11 items-center justify-center rounded-lg border shadow-lg backdrop-blur transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffc72c] ${
                overgroundEnabled
                  ? "border-[#ffc72c] bg-[#ffc72c] text-neutral-900"
                  : "border-white/80 bg-white/95 text-neutral-900 hover:bg-amber-50 dark:border-neutral-700 dark:bg-[#192126]/95 dark:text-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              <TrainFront size={18} aria-hidden="true" />
              <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap rounded-lg border border-white/80 bg-white/95 px-2 py-1 text-xs font-medium text-neutral-900 shadow-lg backdrop-blur group-hover:block dark:border-neutral-700 dark:bg-[#192126]/95 dark:text-neutral-100">
                {overgroundEnabled
                  ? "Hide London Overground lines"
                  : "Show London Overground lines"}
              </span>
            </button>
          }
        </div>
      </main>
      <footer className="flex min-h-7 shrink-0 flex-wrap items-center justify-center px-4 py-1 text-center font-mono text-[10px] text-muted-foreground">
        {overgroundEnabled ? "Live Tube + Overground Map" : "Live Tube Map"}{" "}
        <span className="mx-2 text-muted-foreground/60">·</span> Map data © MapTiler and
        OpenStreetMap contributors <span className="mx-2 text-muted-foreground/60">·</span> Live
        transport data from TfL <span className="mx-2 text-muted-foreground/60">·</span>
        <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy &amp; terms
        </Link>
      </footer>
    </div>
  );
}
