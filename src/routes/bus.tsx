import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";

const BusMap = lazy(() => import("@/components/BusMap"));

export const Route = createFileRoute("/bus")({
  head: () => ({
    meta: [
      { title: "Live London Bus Tracker — London Underground Live" },
      {
        name: "description",
        content: "Choose a London bus route and see its live route and TfL arrival predictions.",
      },
    ],
  }),
  component: BusPage,
});

function BusPage() {
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
            <BusMap />
          </Suspense>
        </ClientOnly>
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-white/80 bg-white/90 px-3 py-2 font-mono text-[10px] leading-relaxed text-neutral-700 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-[#192126]/95 dark:text-neutral-200">
          <p>Zoom to explore the route</p>
          <p>Hover a bus or stop for details</p>
        </div>
      </main>
      <footer className="flex min-h-7 shrink-0 flex-wrap items-center justify-center px-4 py-1 text-center font-mono text-[10px] text-muted-foreground">
        Live Bus Tracker <span className="mx-2 text-muted-foreground/60">·</span> Map data ©
        MapTiler and OpenStreetMap contributors{" "}
        <span className="mx-2 text-muted-foreground/60">·</span> Live predictions from Transport for
        London
      </footer>
    </div>
  );
}
