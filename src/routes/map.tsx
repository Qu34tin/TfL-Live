import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { BusFront, TrainFront } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";

const TubeMap = lazy(() => import("@/components/TubeMap"));
const BusMap = lazy(() => import("@/components/BusMap"));

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Live 3D Tube Map — London Underground Live" },
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

function MapPage() {
  const [busMode, setBusMode] = useState(false);
  const [overgroundEnabled, setOvergroundEnabled] = useState(false);

  return (
    <div className="flex h-screen flex-col bg-background">
      <SiteHeader />
      <main className="relative mx-3 mb-2 min-h-0 flex-1 overflow-hidden rounded-xl border border-white/20 bg-[#f2f1eb] dark:border-neutral-700 dark:bg-[#111820] sm:mx-6">
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
            {busMode ? <BusMap /> : <TubeMap overgroundEnabled={overgroundEnabled} />}
          </Suspense>
        </ClientOnly>
        {!busMode && (
          <>
            <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-white/80 bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-[#192126]/95">
              <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-red-600">
                <span className="pulse-dot h-2 w-2 rounded-full bg-red-500" /> Live
              </p>
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/80 bg-white/90 px-3 py-2 font-mono text-[10px] leading-relaxed text-neutral-700 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-[#192126]/95 dark:text-neutral-200">
              <p>Right-drag to orbit</p>
              <p>Zoom in for buildings</p>
              <p>Click a station for accessibility info</p>
            </div>
          </>
        )}
        <div className="absolute bottom-12 right-3 z-20 flex flex-col items-center gap-2">
          {!busMode && (
            <button
              type="button"
              onClick={() => setOvergroundEnabled((current) => !current)}
              aria-pressed={overgroundEnabled}
              aria-label={overgroundEnabled ? "Hide London Overground lines" : "Show London Overground lines"}
              className={`group relative inline-flex h-11 w-11 items-center justify-center rounded-lg border shadow-lg backdrop-blur transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffc72c] ${
                overgroundEnabled
                  ? "border-[#ffc72c] bg-[#ffc72c] text-neutral-900"
                  : "border-white/80 bg-white/95 text-neutral-900 hover:bg-amber-50 dark:border-neutral-700 dark:bg-[#192126]/95 dark:text-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              <TrainFront size={18} aria-hidden="true" />
              <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap rounded-lg border border-white/80 bg-white/95 px-2 py-1 text-xs font-medium text-neutral-900 shadow-lg backdrop-blur group-hover:block dark:border-neutral-700 dark:bg-[#192126]/95 dark:text-neutral-100">
                {overgroundEnabled ? "Hide London Overground lines" : "Show London Overground lines"}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setBusMode((current) => !current)}
            aria-label={busMode ? "Switch to Tube mode" : "Switch to bus mode"}
            className="group hidden h-11 w-11 items-center justify-center rounded-lg border border-white/80 bg-white/95 text-neutral-900 shadow-lg backdrop-blur transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-neutral-700 dark:bg-[#192126]/95 dark:text-neutral-100 dark:hover:bg-red-950"
            style={{ display: "none" }}
          >
            {busMode ? (
              <TrainFront size={20} aria-hidden="true" />
            ) : (
              <BusFront size={20} aria-hidden="true" />
            )}
            <span
              role="tooltip"
              className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-md bg-neutral-900 px-2.5 py-1.5 font-mono text-xs font-medium text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              {busMode ? "Switch to Tube mode" : "Switch to bus mode"}
            </span>
          </button>
        </div>
      </main>
      <footer className="flex min-h-7 shrink-0 flex-wrap items-center justify-center px-4 py-1 text-center font-mono text-[10px] text-muted-foreground">
        {busMode
          ? "Live Bus Map"
          : overgroundEnabled
            ? "Live Tube + Overground Map"
            : "Live Tube Map"}{" "}
        <span className="mx-2 text-muted-foreground/60">·</span> Map data © MapTiler and
        OpenStreetMap contributors <span className="mx-2 text-muted-foreground/60">·</span> Live
        transport data from TfL
      </footer>
    </div>
  );
}
