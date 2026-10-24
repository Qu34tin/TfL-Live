import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { BusFront, MapPin, Radio } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { createMapTilerStyle } from "@/lib/maptiler-style";
import {
  fetchBusArrivals,
  fetchBusLines,
  fetchBusRoute,
  getBusPositions,
  snapBusPositionsToPaths,
  type BusLine,
  type BusPosition,
} from "@/lib/bus-map";

const LONDON_RED = "#d91f2a";
const BUS_OUTBOUND_YELLOW = "#f6c94b";
const BUS_INBOUND_BLUE = "#3b82f6";

const BUS_ROUTES = [
  { id: "11", destination: "Fulham Broadway — Waterloo" },
  { id: "24", destination: "Hampstead Heath — Pimlico" },
  { id: "38", destination: "Victoria — Clapton" },
  { id: "73", destination: "Victoria — Stoke Newington" },
  { id: "87", destination: "Wandsworth — Aldwych" },
  { id: "139", destination: "Golders Green — Waterloo" },
  { id: "149", destination: "London Bridge — Edmonton" },
  { id: "390", destination: "Victoria — Archway" },
];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function formatEta(seconds: number) {
  return seconds < 60 ? "Due" : `${Math.floor(seconds / 60)} min`;
}

export default function BusMap() {
  const ref = useRef<HTMLDivElement>(null);
  const [routeId, setRouteId] = useState("11");
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const [busCount, setBusCount] = useState(0);
  const [buses, setBuses] = useState<BusPosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busLines, setBusLines] = useState<BusLine[]>(BUS_ROUTES);
  const [isLoadingBusLines, setIsLoadingBusLines] = useState(true);
  const [routeSearch, setRouteSearch] = useState("");
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const selectedRoute = BUS_ROUTES.find((route) => route.id === routeId) ?? BUS_ROUTES[0]!;
  const routeName = busLines.find((line) => line.id === routeId)?.name ?? routeId.toUpperCase();
  const matchingRoutes = routeSearch.trim()
    ? busLines
        .filter(
          (line) =>
            line.id.toLowerCase().includes(routeSearch.trim().toLowerCase()) ||
            line.name.toLowerCase().includes(routeSearch.trim().toLowerCase()),
        )
        .slice(0, 8)
    : [];

  useEffect(() => {
    let cancelled = false;
    fetchBusLines()
      .then((lines) => {
        if (!cancelled) {
          setBusLines(lines);
          setIsLoadingBusLines(false);
        }
      })
      .catch((catalogueError: unknown) => {
        console.error("Unable to load the TfL bus route catalogue", catalogueError);
        if (!cancelled) {
          setCatalogueError("Couldn't load all routes. Try one of the featured routes below.");
          setIsLoadingBusLines(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const themeObserver = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => themeObserver.disconnect();
  }, []);

  useEffect(() => {
    const apiKey = import.meta.env["VITE_MAPTILER_KEY"];
    if (!apiKey) {
      const message =
        "MapTiler key is missing. Add VITE_MAPTILER_KEY to .env.local and restart Vite.";
      console.error(message);
      setError(message);
      return;
    }
    if (!ref.current) return;

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    let animationFrame: number | undefined;
    maplibregl.setWorkerUrl(maplibreWorkerUrl);
    const map = new maplibregl.Map({
      container: ref.current,
      style: createMapTilerStyle(apiKey, isDark),
      center: [-0.12, 51.51],
      zoom: 12,
      attributionControl: { compact: true },
    });
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "tube-popup",
      offset: 14,
    });

    const handleLoad = async () => {
      try {
        const [outboundRoute, inboundRoute] = await Promise.all([
          fetchBusRoute(routeId, "outbound"),
          fetchBusRoute(routeId, "inbound"),
        ]);
        if (cancelled) return;
        const routeFeatures = [
          ...outboundRoute.paths.map((path) => ({
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates: path },
            properties: { direction: "outbound" },
          })),
          ...inboundRoute.paths.map((path) => ({
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates: path },
            properties: { direction: "inbound" },
          })),
        ];
        map.addSource("bus-route", {
          type: "geojson",
          data: { type: "FeatureCollection", features: routeFeatures },
        });
        map.addLayer({
          id: "bus-route-glow",
          type: "line",
          source: "bus-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": LONDON_RED,
            "line-width": 14,
            "line-opacity": 0.17,
            "line-blur": 3,
          },
        });
        map.addLayer({
          id: "bus-route-line",
          type: "line",
          source: "bus-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": LONDON_RED,
            "line-width": 5.5,
            "line-opacity": 0.92,
          },
        });
        map.addSource("bus-stops", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [...outboundRoute.stops, ...inboundRoute.stops]
              .filter(
                (stop, index, stops) =>
                  stops.findIndex((candidate) => candidate.id === stop.id) === index,
              )
              .map((stop) => ({
                type: "Feature" as const,
                geometry: { type: "Point" as const, coordinates: [stop.lon, stop.lat] },
                properties: { name: stop.name },
              })),
          },
        });
        map.addLayer({
          id: "bus-stops",
          type: "circle",
          source: "bus-stops",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 5],
            "circle-color": "#fffdf5",
            "circle-stroke-color": LONDON_RED,
            "circle-stroke-width": 1.5,
          },
        });
        map.addSource("buses", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "buses-halo",
          type: "circle",
          source: "buses",
          paint: {
            "circle-radius": 19,
            "circle-color": [
              "match",
              ["get", "direction"],
              "inbound",
              BUS_INBOUND_BLUE,
              BUS_OUTBOUND_YELLOW,
            ],
            "circle-opacity": 0.34,
            "circle-blur": 0.5,
          },
        });
        map.addLayer({
          id: "buses",
          type: "circle",
          source: "buses",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 8, 14, 12],
            "circle-color": [
              "match",
              ["get", "direction"],
              "inbound",
              BUS_INBOUND_BLUE,
              BUS_OUTBOUND_YELLOW,
            ],
            "circle-stroke-color": "#24231f",
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "bus-labels",
          type: "symbol",
          source: "buses",
          layout: {
            "text-field": ["get", "route"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 10,
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#24231f" },
        });
        map.on("mousemove", "buses", (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          map.getCanvas().style.cursor = "pointer";
          popup
            .setLngLat(event.lngLat)
            .setHTML(String(feature.properties?.["html"] ?? ""))
            .addTo(map);
        });
        map.on("mouseleave", "buses", () => {
          map.getCanvas().style.cursor = "";
          popup.remove();
        });
        map.on("mousemove", "bus-stops", (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          map.getCanvas().style.cursor = "pointer";
          popup
            .setLngLat(event.lngLat)
            .setHTML(
              `<strong>${escapeHtml(String(feature.properties?.["name"] ?? "Bus stop"))}</strong>`,
            )
            .addTo(map);
        });
        map.on("mouseleave", "bus-stops", () => {
          map.getCanvas().style.cursor = "";
          popup.remove();
        });

        const bounds = new maplibregl.LngLatBounds();
        for (const path of [...outboundRoute.paths, ...inboundRoute.paths]) {
          for (const coordinate of path) bounds.extend(coordinate);
        }
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 70, maxZoom: 14 });

        let latestArrivals: Awaited<ReturnType<typeof fetchBusArrivals>> = [];
        let arrivalsReceivedAt = Date.now();
        const updateBusSource = (elapsedSeconds: number) => {
          const positions = [
            ...snapBusPositionsToPaths(
              getBusPositions(latestArrivals, outboundRoute.stops, "outbound", elapsedSeconds),
              outboundRoute.paths,
            ),
            ...snapBusPositionsToPaths(
              getBusPositions(latestArrivals, inboundRoute.stops, "inbound", elapsedSeconds),
              inboundRoute.paths,
            ),
          ];
          const source = map.getSource("buses") as maplibregl.GeoJSONSource | undefined;
          source?.setData({
            type: "FeatureCollection",
            features: positions.map((bus) => ({
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: bus.coordinates },
              properties: {
                direction: bus.direction,
                route: routeId.toUpperCase(),
                html: `<strong>Route ${escapeHtml(routeId.toUpperCase())} · ${escapeHtml(bus.vehicleId)}</strong><p>${bus.direction === "inbound" ? "Inbound" : "Outbound"} to ${escapeHtml(bus.destination || "route terminus")}</p><p>Next stop: ${escapeHtml(bus.nextStop)} · ${formatEta(bus.timeToStation)}</p><p>Approximate position from TfL arrival predictions</p>`,
              },
            })),
          });
        };
        const animateBuses = () => {
          if (cancelled) return;
          updateBusSource((Date.now() - arrivalsReceivedAt) / 1000);
          animationFrame = requestAnimationFrame(animateBuses);
        };
        animationFrame = requestAnimationFrame(animateBuses);

        const refreshBuses = async () => {
          try {
            const arrivals = await fetchBusArrivals(routeId);
            if (cancelled) return;
            latestArrivals = arrivals;
            arrivalsReceivedAt = Date.now();
            const positions = [
              ...snapBusPositionsToPaths(
                getBusPositions(arrivals, outboundRoute.stops, "outbound"),
                outboundRoute.paths,
              ),
              ...snapBusPositionsToPaths(
                getBusPositions(arrivals, inboundRoute.stops, "inbound"),
                inboundRoute.paths,
              ),
            ];
            setBuses(positions);
            setBusCount(positions.length);
            setError(null);
          } catch (feedError) {
            console.error(`Unable to load live predictions for bus ${routeId}`, feedError);
            setError("Live bus predictions are temporarily unavailable. Retrying shortly.");
          }
        };
        await refreshBuses();
        if (!cancelled) refreshTimer = setInterval(refreshBuses, 30_000);
      } catch (routeError) {
        console.error(`Unable to load bus ${routeId} route`, routeError);
        setError(`The route for bus ${routeId} could not be loaded. Please try another route.`);
      }
    };
    map.on("load", handleLoad);

    return () => {
      cancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      popup.remove();
      map.remove();
    };
  }, [isDark, routeId]);

  return (
    <>
      <div ref={ref} className="absolute inset-0 h-full w-full" />
      <section className="absolute left-3 top-3 z-10 w-[min(22rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-white/70 bg-white/95 text-neutral-900 shadow-xl backdrop-blur dark:border-neutral-700 dark:bg-[#192126]/95 dark:text-neutral-100 sm:left-5 sm:top-5">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
              <BusFront size={19} aria-hidden="true" />
            </span>
            <div>
              <p className="font-display text-base font-bold">Live bus tracker</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                London · TfL predictions
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <Radio size={11} aria-hidden="true" /> Live
          </span>
        </div>

        <div className="space-y-3 p-4">
          <div className="relative">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Find a bus route
              </span>
              <input
                type="search"
                value={routeSearch}
                onChange={(event) => setRouteSearch(event.target.value)}
                placeholder={
                  isLoadingBusLines
                    ? "Loading TfL routes…"
                    : `Search ${busLines.length} London routes`
                }
                aria-label="Search bus routes"
                aria-controls="bus-route-results"
                aria-expanded={matchingRoutes.length > 0}
                autoComplete="off"
                className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 font-display text-sm font-semibold outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-red-600 focus:ring-2 focus:ring-red-600/20 dark:border-neutral-600 dark:bg-neutral-800"
              />
            </label>
            {matchingRoutes.length > 0 && (
              <div
                id="bus-route-results"
                role="listbox"
                aria-label="Matching bus routes"
                className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
              >
                {matchingRoutes.map((line) => (
                  <button
                    key={line.id}
                    type="button"
                    role="option"
                    aria-selected={line.id === routeId}
                    onClick={() => {
                      setRouteId(line.id);
                      setRouteSearch("");
                    }}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  >
                    <span className="font-display font-bold">{line.name}</span>
                    <span className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
                      Route {line.id}
                    </span>
                  </button>
                ))}
                {busLines.filter(
                  (line) =>
                    line.id.toLowerCase().includes(routeSearch.trim().toLowerCase()) ||
                    line.name.toLowerCase().includes(routeSearch.trim().toLowerCase()),
                ).length > matchingRoutes.length && (
                  <p className="px-3 py-1.5 font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
                    Keep typing to narrow the results
                  </p>
                )}
              </div>
            )}
            {catalogueError && (
              <p role="status" className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                {catalogueError}
              </p>
            )}
            <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
              {isLoadingBusLines
                ? "Loading the full TfL bus route list…"
                : `${busLines.length} TfL routes available · try 24, N15, or N8`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {BUS_ROUTES.map((route) => (
                <button
                  key={route.id}
                  type="button"
                  onClick={() => {
                    setRouteId(route.id);
                    setRouteSearch("");
                  }}
                  className={`rounded-md border px-2 py-1 font-mono text-[10px] transition-colors ${
                    routeId === route.id
                      ? "border-red-300 bg-red-50 font-bold text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`}
                  aria-label={`Choose route ${route.id}`}
                >
                  {route.id}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-lg bg-red-50 px-3 py-2.5 dark:bg-red-950/50">
            <div className="flex items-start gap-2">
              <MapPin
                size={15}
                className="mt-0.5 shrink-0 text-red-700 dark:text-red-300"
                aria-hidden="true"
              />
              <div>
                <p className="font-display text-sm font-bold">Route {routeName}</p>
                <p className="text-xs text-neutral-600 dark:text-neutral-300">
                  {selectedRoute.id === routeId ? selectedRoute.destination : "London bus route"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="font-mono text-[10px] font-semibold text-neutral-500 dark:text-neutral-400">
                {busCount} {busCount === 1 ? "bus" : "buses"}
              </span>
              <span className="font-mono text-[10px] font-semibold text-yellow-600 dark:text-yellow-300">
                {buses.filter((bus) => bus.direction === "outbound").length} out
              </span>
              <span className="font-mono text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                {buses.filter((bus) => bus.direction === "inbound").length} in
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] font-semibold uppercase tracking-wide">
            <span className="inline-flex items-center gap-1.5 text-yellow-600 dark:text-yellow-300">
              <span className="h-2 w-2 rounded-full bg-yellow-500" />
              Outbound · {buses.filter((bus) => bus.direction === "outbound").length}
            </span>
            <span className="inline-flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              Inbound · {buses.filter((bus) => bus.direction === "inbound").length}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Bus dots show approximate positions calculated from live TfL arrival predictions; they
            are not GPS locations.
          </p>
          {error && (
            <p
              role="alert"
              className="rounded-md bg-red-100 px-3 py-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200"
            >
              {error}
            </p>
          )}
          <div className="space-y-3 border-t border-neutral-200 pt-3 dark:border-neutral-700">
            {(["outbound", "inbound"] as const).map((busDirection) => {
              const directionBuses = buses.filter((bus) => bus.direction === busDirection);
              const isOutbound = busDirection === "outbound";
              return (
                <section key={busDirection} aria-label={`${busDirection} buses`}>
                  <h3
                    className={`mb-1.5 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                      isOutbound
                        ? "text-yellow-600 dark:text-yellow-300"
                        : "text-blue-700 dark:text-blue-300"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${isOutbound ? "bg-yellow-500" : "bg-blue-500"}`}
                    />
                    {busDirection} · {directionBuses.length}
                  </h3>
                  {directionBuses.length > 0 ? (
                    <div className="space-y-1.5">
                      {directionBuses.slice(0, 5).map((bus) => (
                        <div
                          key={bus.vehicleId}
                          className="flex items-center justify-between gap-3 text-xs"
                        >
                          <span className="truncate text-neutral-600 dark:text-neutral-300">
                            <strong className="mr-1.5 text-neutral-900 dark:text-white">
                              {bus.vehicleId}
                            </strong>
                            {bus.nextStop}
                          </span>
                          <span
                            className={`shrink-0 font-mono text-[11px] font-semibold ${
                              isOutbound
                                ? "text-yellow-600 dark:text-yellow-300"
                                : "text-blue-700 dark:text-blue-300"
                            }`}
                          >
                            {formatEta(bus.timeToStation)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      No live predictions right now
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
