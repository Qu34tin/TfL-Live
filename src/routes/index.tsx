import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { fetchLineStatus, LINE_COLOURS } from "@/lib/tfl";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "London Underground Live — Tube & Elizabeth line status" },
      {
        name: "description",
        content: "Live status for every Tube and Elizabeth line, refreshed every 30 seconds.",
      },
      { property: "og:title", content: "London Underground Live" },
      { property: "og:description", content: "Real-time Tube line status and departure boards." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ["status"],
    queryFn: fetchLineStatus,
    refetchInterval: 30_000,
  });
  const disrupted =
    data?.filter((l) => l.lineStatuses.some((s) => s.statusSeverity !== 10)).length ?? 0;

  return (
    <div className="h-screen overflow-y-auto hide-scrollbar">
      <SiteHeader />
      <section className="track-lines border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-20 md:py-28">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-good" /> Live
          </p>
          <h1 className="max-w-3xl font-display text-5xl font-extrabold leading-[0.95] tracking-tight md:text-7xl">
            The whole Tube, <span className="text-primary">right now.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Every line, every disruption, every next train — straight from the network, updated as
            it moves.
          </p>
          <div className="mt-10 flex flex-wrap gap-8 font-mono">
            <Stat label="Lines" value={data ? String(data.length) : "—"} />
            <Stat
              label="Disrupted"
              value={data ? String(disrupted) : "—"}
              tone={disrupted ? "warn" : "good"}
            />
            <Stat
              label="Good service"
              value={data ? String(data.length - disrupted) : "—"}
              tone="good"
            />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-5 py-14">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="font-display text-2xl font-bold">Line status</h2>
          {dataUpdatedAt > 0 && (
            <span className="font-mono text-xs text-muted-foreground">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString("en-GB")}
            </span>
          )}
        </div>
        {error && <p className="text-destructive">Couldn't load live status. Retrying…</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {isLoading &&
            Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-card" />
            ))}
          {data?.map((line) => {
            const s = line.lineStatuses[0];
            if (!s) return null;
            const good = s.statusSeverity === 10;
            return (
              <article
                key={line.id}
                className="flex overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="w-2 shrink-0" style={{ background: LINE_COLOURS[line.id] }} />
                <div className="flex-1 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-display text-lg font-semibold">{line.name}</h3>
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-mono text-xs ${good ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}
                    >
                      {s.statusSeverityDescription}
                    </span>
                  </div>
                  {s.reason && (
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{s.reason}</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <div className="mt-12 rounded-xl border border-border bg-board p-8 md:flex md:items-center md:justify-between">
          <div>
            <p className="led-text text-sm uppercase">Next train</p>
            <h3 className="mt-2 font-display text-2xl font-bold">Check live departure boards</h3>
          </div>
          <Link
            to="/boards"
            className="mt-5 inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform hover:scale-105 md:mt-0"
          >
            Open boards →
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const color = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-foreground";
  return (
    <div>
      <div className={`text-4xl font-bold ${color}`}>{value}</div>
      <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}
