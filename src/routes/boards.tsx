import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Accessibility, AlertCircle, Info, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import {
  cleanName,
  fetchAllStations,
  fetchArrivals,
  fetchStationArrivals,
  fetchStationAccessibility,
  LINE_COLOURS,
  minutes,
  OVERGROUND_LINE_IDS,
  STATIONS,
  TUBE_LINES,
} from "@/lib/tfl";

const TUBE_AND_ELIZABETH_LINE_IDS = [...TUBE_LINES, "elizabeth"];

type Stop = { id: string; name: string; stopIds?: string[] };

export const Route = createFileRoute("/boards")({
  head: () => ({
    meta: [
      { title: "Live Departure Boards — London Underground Live" },
      {
        name: "description",
        content: "Search Tube and Elizabeth line stations for live departures.",
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

  const { data: allStations } = useQuery({
    queryKey: ["stations"],
    queryFn: fetchAllStations,
    staleTime: Infinity,
  });
  const overgroundSet = new Set<string>(OVERGROUND_LINE_IDS);
  const counts = useMemo(() => {
    if (!allStations) return { tube: 0, overground: 0, dlr: 0 };
    return {
      tube: allStations
        .filter((station) =>
          station.lines.some((line) => TUBE_AND_ELIZABETH_LINE_IDS.includes(line)),
        ).length,
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
  };

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
    <div className="h-screen overflow-y-auto hide-scrollbar">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-14">
        <h1 className="font-display text-4xl font-extrabold tracking-tight md:text-5xl">
          Departure boards
        </h1>
          <p className="mt-3 text-muted-foreground">
            Search any of{" "}
            {allStations
              ? `${counts.tube} Tube and Elizabeth line, ${counts.overground} Overground, ${counts.dlr} DLR`
              : "270+"}
            stations. Boards refresh every 20 seconds.
          </p>

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

        <div className="mt-5 flex flex-wrap gap-2">
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

        <h2 className="mt-12 font-display text-2xl font-bold">{stop.name}</h2>
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
            <section
              key={key}
              className="overflow-hidden rounded-xl border border-border bg-board"
            >
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
