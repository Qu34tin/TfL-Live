import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import {
  cleanName,
  fetchAllStations,
  fetchArrivals,
  LINE_COLOURS,
  minutes,
  STATIONS,
} from "@/lib/tfl";

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
  const [stop, setStop] = useState<{ id: string; name: string }>(STATIONS[0]!);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const { data: allStations } = useQuery({
    queryKey: ["stations"],
    queryFn: fetchAllStations,
    staleTime: Infinity,
  });
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
    queryKey: ["arrivals", stop.id],
    queryFn: () => fetchArrivals(stop.id),
    refetchInterval: 20_000,
  });

  const platforms = new Map<string, NonNullable<typeof data>>();
  data?.forEach((a) => {
    const list = platforms.get(a.platformName) ?? [];
    if (list.length < 4) list.push(a);
    platforms.set(a.platformName, list);
  });

  const pick = (s: { id: string; name: string }) => {
    setStop(s);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="h-screen overflow-y-auto hide-scrollbar">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-14">
        <h1 className="font-display text-4xl font-extrabold tracking-tight md:text-5xl">
          Departure boards
        </h1>
        <p className="mt-3 text-muted-foreground">
          Search any of {allStations ? allStations.length : "270+"} Tube and Elizabeth line
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
          {STATIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => pick(s)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                s.id === stop.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>

        <h2 className="mt-12 font-display text-2xl font-bold">{stop.name}</h2>
        {error && <p className="mt-4 text-destructive">Couldn't load arrivals. Retrying…</p>}
        {isLoading && <div className="mt-6 h-48 animate-pulse rounded-xl bg-board" />}
        {data && data.length === 0 && (
          <p className="mt-4 text-muted-foreground">No trains due right now.</p>
        )}
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {[...platforms.entries()].map(([platform, arrivals]) => (
            <section
              key={platform}
              className="overflow-hidden rounded-xl border border-border bg-board"
            >
              <div
                className="h-1.5"
                style={{ background: LINE_COLOURS[arrivals[0]!.lineId] ?? "var(--primary)" }}
              />
              <div className="p-5">
                <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
                  {arrivals[0]!.lineName} · {platform}
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
