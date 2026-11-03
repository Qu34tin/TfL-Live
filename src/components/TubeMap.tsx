import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { createMapTilerStyle } from "@/lib/maptiler-style";
import { cleanRailPaths, prepareOverlappingLines, routeThroughRail } from "@/lib/line-offsets";
import {
  fetchElizabethLineArrivals,
  fetchElizabethLineData,
  fetchOsmRailPaths,
  fetchOsmTubeBranchPaths,
  fetchTfLRouteDataAllDirections,
  fetchTrainActions,
  fetchTubeMapData,
  extractPathBetweenStations,
  groupStationMarkers,
  getTrackEndpointConnectors,
  getElizabethLineTrainPositions,
  getLineTrainPositions,
  getTrainPositions,
  snapCoordinateToRailPaths,
  snapTrackSegmentsToStations,
  secondsSinceUtcMidnight,
  type ElizabethLineArrival,
  type Coordinate,
  type TrainActions,
  type TrackSegment,
} from "@/lib/tube-train-map";
import { buildTrainTooltipHtml, escapeHtml } from "@/lib/train-tooltip";
import type { JourneyRoute } from "@/lib/journey-route";
import {
  LINE_COLOURS,
  OVERGROUND_LINE_IDS,
  fetchLineArrivals,
  fetchOvergroundArrivals,
  fetchStationAccessibility,
  type StationAccessibilityItem,
  type LineArrival,
  type Station,
} from "@/lib/tfl";

const LINE_DISPLAY_NAMES: Record<string, string> = {
  "hammersmith-city": "Hammersmith & City",
  "waterloo-city": "Waterloo & City",
  dlr: "DLR",
  tram: "Tram",
};
const OVERGROUND_LINE_SET = new Set<string>(OVERGROUND_LINE_IDS);

function getLineName(lineId: string) {
  return (
    LINE_DISPLAY_NAMES[lineId] ??
    lineId
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function getLineBadgeHtml(lineId: string) {
  const color = LINE_COLOURS[lineId] ?? "#64748b";
  const textColor = ["circle", "lioness", "suffragette"].includes(lineId) ? "#1f2937" : "#ffffff";
  const label =
    lineId === "dlr" || lineId === "tram" ? getLineName(lineId) : `${getLineName(lineId)} line`;
  return `<li class="station-accessibility__line" style="--line-color:${color};--line-text-color:${textColor}">${escapeHtml(label)}</li>`;
}

// Keeps the route clear of the journey panel (side panel on desktop, bottom sheet on phones).
function journeyPadding() {
  const wide = window.innerWidth >= 640;
  return wide
    ? { top: 90, right: 80, bottom: 70, left: 400 }
    : { top: 90, right: 40, bottom: Math.round(window.innerHeight * 0.5), left: 40 };
}

export default function TubeMap({
  overgroundEnabled,
  selectedStation,
  hiddenLines = [],
  journeyRoute = null,
  activeStep = null,
}: {
  overgroundEnabled: boolean;
  selectedStation: Station | null;
  hiddenLines?: string[];
  journeyRoute?: JourneyRoute | null;
  activeStep?: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overgroundEnabledRef = useRef(overgroundEnabled);
  const hiddenLinesRef = useRef(hiddenLines);
  const journeyActiveRef = useRef(Boolean(journeyRoute));
  const applyLineFilterRef = useRef<() => void>(() => undefined);
  const cameraRef = useRef<{
    center: [number, number];
    zoom: number;
    pitch: number;
    bearing: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    if (!selectedStation || !isMapReady || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [selectedStation.lon, selectedStation.lat],
      zoom: 16,
      duration: 1200,
    });
  }, [isMapReady, selectedStation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!isMapReady || !map) return;
    const sourceId = "journey-route";
    const layerIds = [
      "journey-route-casing",
      "journey-route-line",
      "journey-route-walk",
      "journey-line-labels",
      "journey-stops-ring",
      "journey-stops-end",
      "journey-stop-names",
    ];
    for (const id of layerIds) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    if (!journeyRoute || journeyRoute.segments.length === 0) return undefined;

    const isLight = (hex: string) => {
      const value = Number.parseInt(hex.replace("#", ""), 16);
      const luminance =
        0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
      return luminance > 150;
    };
    map.addSource(sourceId, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          ...journeyRoute.segments.map((segment) => ({
            type: "Feature" as const,
            properties: {
              colour: segment.colour,
              textColour: isLight(segment.colour) ? "#111827" : "#ffffff",
              walking: segment.walking,
              step: segment.step,
              name: segment.label,
            },
            geometry: { type: "LineString" as const, coordinates: segment.coordinates },
          })),
          ...journeyRoute.stops.map((stop, index) => {
            const steps = journeyRoute.steps;
            const toStep = stop.kind === "end" ? steps[steps.length - 1] : steps[stop.number ?? 0];
            const fromStep = stop.kind === "interchange" ? steps[(stop.number ?? 1) - 1] : toStep;
            return {
              type: "Feature" as const,
              properties: {
                kind: stop.kind,
                name: stop.name,
                number: stop.number === undefined ? "" : String(stop.number),
                fromColour: fromStep?.colour ?? "#111827",
                toColour: toStep?.colour ?? "#111827",
                badges: [...new Set([fromStep, toStep])]
                  .filter((step): step is NonNullable<typeof step> => Boolean(step))
                  .map(
                    (step) =>
                      `<li class="station-accessibility__line" style="--line-color:${step.colour};--line-text-color:${isLight(step.colour) ? "#1f2937" : "#ffffff"}">${escapeHtml(step.label)}</li>`,
                  )
                  .join(""),
                // Lets end points win label collisions over interchanges.
                priority: stop.kind === "interchange" ? index + 10 : index,
              },
              geometry: { type: "Point" as const, coordinates: stop.coordinates },
            };
          }),
        ],
      },
    });

    const zoomWidth = (z9: number, z12: number, z15: number, z17: number) =>
      [
        "interpolate",
        ["linear"],
        ["zoom"],
        9,
        z9,
        12,
        z12,
        15,
        z15,
        17,
        z17,
      ] as maplibregl.ExpressionSpecification;
    const isLine = ["==", ["geometry-type"], "LineString"] as maplibregl.ExpressionSpecification;
    const solid = [
      "all",
      isLine,
      ["!=", ["get", "walking"], true],
    ] as maplibregl.FilterSpecification;
    const lineLayout = { "line-cap": "round" as const, "line-join": "round" as const };
    const ink = isDark ? "#f8fafc" : "#111827";
    const halo = isDark ? "rgba(10,14,20,0.92)" : "rgba(255,255,255,0.95)";
    const font = ["Noto Sans Bold"];

    map.addLayer({
      id: "journey-route-casing",
      type: "line",
      source: sourceId,
      filter: solid,
      layout: lineLayout,
      paint: {
        "line-color": isDark ? "#0a0e14" : "#ffffff",
        "line-width": zoomWidth(6, 11, 17, 24),
      },
    });
    map.addLayer({
      id: "journey-route-line",
      type: "line",
      source: sourceId,
      filter: solid,
      layout: lineLayout,
      paint: { "line-color": ["get", "colour"], "line-width": zoomWidth(3.5, 7, 12, 17) },
    });
    map.addLayer({
      id: "journey-route-walk",
      type: "line",
      source: sourceId,
      filter: ["all", isLine, ["==", ["get", "walking"], true]],
      layout: { "line-join": "round" },
      paint: {
        "line-color": isDark ? "#e2e8f0" : "#334155",
        "line-width": zoomWidth(2, 3.5, 5, 7),
        "line-dasharray": [0.6, 1.6],
      },
    });
    map.addLayer({
      id: "journey-line-labels",
      type: "symbol",
      source: sourceId,
      filter: solid,
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "name"],
        "text-font": font,
        "text-size": 11,
        "text-letter-spacing": 0.04,
        "text-keep-upright": true,
        "symbol-spacing": 280,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-max-angle": 40,
      },
      paint: {
        "text-color": ["get", "textColour"],
        "text-halo-color": ["get", "colour"],
        "text-halo-width": 1,
      },
      minzoom: 9,
    });

    const stopFilter = ["==", ["geometry-type"], "Point"] as maplibregl.FilterSpecification;
    const kindIs = (kind: string) =>
      ["==", ["get", "kind"], kind] as maplibregl.ExpressionSpecification;
    // Same station style as the live map (cream fill, dark ring) but sized by zoom,
    // so points shrink when zooming out. Interchanges get a larger, heavier ring.
    map.addLayer({
      id: "journey-stops-ring",
      type: "circle",
      source: sourceId,
      filter: stopFilter,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          ["case", kindIs("interchange"), 4, 3],
          12,
          ["case", kindIs("interchange"), 7, 5.5],
          17,
          ["case", kindIs("interchange"), 12, 10],
        ],
        "circle-color": "#faf8ef",
        "circle-stroke-color": "#494b45",
        "circle-stroke-width": ["case", kindIs("interchange"), 3, 2],
      },
    });
    map.addLayer({
      id: "journey-stops-end",
      type: "circle",
      source: sourceId,
      filter: ["all", stopFilter, kindIs("end")] as maplibregl.FilterSpecification,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 12, 2.5, 17, 5],
        "circle-color": "#494b45",
      },
    });

    map.addLayer({
      id: "journey-stop-names",
      type: "symbol",
      source: sourceId,
      filter: stopFilter,
      minzoom: 10,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-anchor": "top",
        "text-offset": [0, 0.9],
        "text-max-width": 8,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "symbol-sort-key": ["get", "priority"],
      },
      paint: {
        "text-color": "#e8e6dc",
        "text-halo-color": "rgba(12,14,18,0.92)",
        "text-halo-width": 1.6,
      },
    });
    const hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "tube-popup",
      offset: 12,
    });
    const onStopMove = (event: maplibregl.MapLayerMouseEvent) => {
      const properties = event.features?.[0]?.properties;
      if (!properties) return;
      const kind = String(properties["kind"]);
      const eyebrow =
        kind === "interchange" ? "Change here" : kind === "start" ? "Start" : "Destination";
      map.getCanvas().style.cursor = "pointer";
      hoverPopup
        .setLngLat(event.lngLat)
        .setHTML(
          `<section class="station-accessibility"><p class="station-accessibility__eyebrow">${eyebrow}</p><h2 class="station-accessibility__title">${escapeHtml(String(properties["name"]))}</h2><ul class="station-accessibility__lines">${String(properties["badges"])}</ul></section>`,
        )
        .addTo(map);
    };
    const onStopLeave = () => {
      map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    };
    map.on("mousemove", "journey-stops-ring", onStopMove);
    map.on("mouseleave", "journey-stops-ring", onStopLeave);
    return () => {
      map.off("mousemove", "journey-stops-ring", onStopMove);
      map.off("mouseleave", "journey-stops-ring", onStopLeave);
      hoverPopup.remove();
    };
  }, [isDark, isMapReady, journeyRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!isMapReady || !map || !journeyRoute) return;
    const bounds = activeStep !== null ? journeyRoute.steps[activeStep]?.bounds : undefined;
    if (!bounds) {
      if (activeStep === null) {
        const all = new maplibregl.LngLatBounds();
        for (const segment of journeyRoute.segments) {
          for (const coordinate of segment.coordinates) all.extend(coordinate);
        }
        map.fitBounds(all, { padding: journeyPadding(), duration: 900, maxZoom: 15, pitch: 0 });
      }
      return;
    }
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: journeyPadding(), duration: 900, maxZoom: 15.5, pitch: 0 },
    );
  }, [activeStep, isMapReady, journeyRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!isMapReady || !map) return;
    const fade = (on: number, off: number) =>
      activeStep === null
        ? on
        : ([
            "case",
            ["==", ["get", "step"], activeStep],
            on,
            off,
          ] as maplibregl.ExpressionSpecification);
    if (map.getLayer("journey-route-line")) {
      map.setPaintProperty("journey-route-line", "line-opacity", fade(1, 0.3));
      map.setPaintProperty("journey-route-casing", "line-opacity", fade(0.9, 0.25));
      map.setPaintProperty("journey-route-walk", "line-opacity", fade(1, 0.3));
    }
  }, [activeStep, isMapReady, journeyRoute]);

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
    hiddenLinesRef.current = hiddenLines;
    applyLineFilterRef.current();
  }, [hiddenLines]);

  useEffect(() => {
    journeyActiveRef.current = Boolean(journeyRoute);
    applyLineFilterRef.current();
  }, [journeyRoute]);

  useEffect(() => {
    overgroundEnabledRef.current = overgroundEnabled;
    const map = mapRef.current;
    if (!map) return;
    applyLineFilterRef.current();
    for (const layerId of [
      "overground-lines-glow",
      "overground-lines",
      "overground-stations",
      "overground-trains-halo",
      "overground-trains",
    ]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", overgroundEnabled ? "visible" : "none");
      }
    }
  }, [overgroundEnabled]);

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

    maplibregl.setWorkerUrl(maplibreWorkerUrl);
    const camera = cameraRef.current;
    const map = new maplibregl.Map({
      container: ref.current,
      style: createMapTilerStyle(apiKey, isDark),
      center: camera?.center ?? [-0.118092, 51.509865],
      zoom: camera?.zoom ?? 11,
      pitch: camera?.pitch ?? 50,
      bearing: camera?.bearing ?? 0,
      maxPitch: 75,
      minZoom: 9,
      maxZoom: 17,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    let trainActions: TrainActions | undefined;
    let lineArrivals: LineArrival[] = [];
    let overgroundArrivals: LineArrival[] = [];
    let lineArrivalsFetchedAt = 0;
    let overgroundArrivalsFetchedAt = 0;
    let elizabethArrivals: ElizabethLineArrival[] = [];
    let elizabethArrivalsFetchedAt = 0;
    let elizabethStations: Awaited<ReturnType<typeof fetchElizabethLineData>>["stations"] = [];
    let elizabethSegments: TrackSegment[] = [];
    const overgroundSegments: TrackSegment[] = [];
    const overgroundStationIds = new Set<string>();
    const railPathsByLine = new Map<string, Coordinate[][]>();
    let actionRefreshTimer: ReturnType<typeof setInterval> | undefined;
    let animationFrame: number | undefined;
    let cancelled = false;
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "tube-popup",
      offset: 12,
    });
    let selectedStationId = "";
    const stationPopup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: "tube-popup",
      offset: 12,
    });
    stationPopup.on("close", () => {
      selectedStationId = "";
    });
    const stationAccessibilityCache = new Map<string, Promise<StationAccessibilityItem[]>>();

    const stationAccessibilityHtml = (
      stationName: string,
      linesHtml: string,
      items: StationAccessibilityItem[],
    ) => {
      const details = items.length
        ? `<ul class="station-accessibility__list">${items
            .map(
              (item) =>
                `<li class="station-accessibility__item"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></li>`,
            )
            .join("")}</ul>`
        : '<p class="station-accessibility__empty">TfL has not provided accessibility details for this station.</p>';
      return `<section class="station-accessibility"><p class="station-accessibility__eyebrow">Station information</p><h2 class="station-accessibility__title">${escapeHtml(stationName)}</h2><p class="station-accessibility__section-title">Lines serving this station</p>${linesHtml}<p class="station-accessibility__source">Accessibility information reported by TfL</p>${details}</section>`;
    };

    const updateTrainPositions = () => {
      if (!trainActions) return;
      const source = map.getSource("trains") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      const positions = getTrainPositions(
        trainActions,
        segments,
        stations,
        secondsSinceUtcMidnight(new Date()),
      );
      source.setData({
        type: "FeatureCollection",
        features: positions.map((train) => {
          const color = LINE_COLOURS[train.lineId] ?? "#ffffff";
          const railPaths = railPathsByLine.get(train.lineId);
          const coordinates = railPaths?.length
            ? snapCoordinateToRailPaths(train.coordinates, railPaths, 400)
            : train.coordinates;

          return {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates },
            properties: {
              color,
              lineId: train.lineId,
              trainId: train.trainId,
              html: buildTrainTooltipHtml(train, stationNames),
            },
          };
        }),
      });
    };

    const updateLineTrainPositions = () => {
      const source = map.getSource("line-trains") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      const elapsedSeconds = Math.max(0, (Date.now() - lineArrivalsFetchedAt) / 1000);
      const positions = (["dlr", "tram"] as const).flatMap((lineId) =>
        getLineTrainPositions(
          lineArrivals.filter((arrival) => arrival.lineId === lineId),
          lineId,
          segments,
          stations,
          secondsSinceUtcMidnight(new Date()),
          undefined,
          elapsedSeconds,
        ),
      );
      source.setData({
        type: "FeatureCollection",
        features: positions.map((train) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: snapCoordinateToRailPaths(
              train.coordinates,
              railPathsByLine.get(train.lineId) ?? [],
              400,
            ),
          },
          properties: {
            color: LINE_COLOURS[train.lineId] ?? "#ffffff",
            lineId: train.lineId,
            trainId: train.trainId,
            html: buildTrainTooltipHtml(train, stationNames),
          },
        })),
      });
    };

    const updateOvergroundTrainPositions = () => {
      const source = map.getSource("overground-trains") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      const positions = OVERGROUND_LINE_IDS.flatMap((lineId) =>
        getLineTrainPositions(
          overgroundArrivals.filter((arrival) => arrival.lineId === lineId),
          lineId,
          overgroundSegments,
          stations,
          secondsSinceUtcMidnight(new Date()),
          900,
          Math.max(0, (Date.now() - overgroundArrivalsFetchedAt) / 1000),
        ),
      );
      source.setData({
        type: "FeatureCollection",
        features: positions.map((train) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: snapCoordinateToRailPaths(
              train.coordinates,
              railPathsByLine.get(train.lineId) ?? [],
              400,
            ),
          },
          properties: {
            color: LINE_COLOURS[train.lineId] ?? "#ffffff",
            lineId: train.lineId,
            trainId: train.trainId,
            html: buildTrainTooltipHtml(train, stationNames),
          },
        })),
      });
    };

    const updateElizabethLineTrainPositions = () => {
      const source = map.getSource("elizabeth-trains") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      const positions = getElizabethLineTrainPositions(
        elizabethArrivals,
        elizabethSegments,
        elizabethStations,
        secondsSinceUtcMidnight(new Date()),
        Math.max(0, (Date.now() - elizabethArrivalsFetchedAt) / 1000),
      );
      source.setData({
        type: "FeatureCollection",
        features: positions.map((train) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: train.coordinates },
          properties: {
            color: LINE_COLOURS[train.lineId] ?? "#666",
            lineId: train.lineId,
            trainId: train.trainId,
            html: buildTrainTooltipHtml(train, stationNames),
          },
        })),
      });
    };

    let stations: Awaited<ReturnType<typeof fetchTubeMapData>>["stations"] = [];
    let segments: Awaited<ReturnType<typeof fetchTubeMapData>>["segments"] = [];
    let displayedLinePaths: { lineId: string; path: Coordinate[] }[] = [];
    let stationNames = new Map<string, string>();

    const handleMapLoad = async () => {
      setIsMapReady(true);
      try {
        const mapData = await fetchTubeMapData();
        if (cancelled) return;
        stations = mapData.stations;
        segments = mapData.segments;
        displayedLinePaths = snapTrackSegmentsToStations(mapData.segments, stations).map(
          ({ lineId, path }) => ({ lineId, path }),
        );
        // The Piccadilly shares the District track between Hammersmith and Acton Town, but the map data has no segment there.
        {
          const district = mapData.segments.filter((segment) => segment.lineId === "district");
          const walk = (from: string, to: string) => {
            const queue: { id: string; path: Coordinate[] }[] = [{ id: from, path: [] }];
            const seen = new Set([from]);
            while (queue.length) {
              const current = queue.shift()!;
              if (current.id === to) return current.path;
              for (const segment of district) {
                const forward = segment.fromStationId === current.id;
                if (!forward && segment.toStationId !== current.id) continue;
                const next = forward ? segment.toStationId : segment.fromStationId;
                if (seen.has(next)) continue;
                seen.add(next);
                const part = forward ? segment.path : [...segment.path].reverse();
                queue.push({ id: next, path: [...current.path, ...part] });
              }
            }
            return undefined;
          };
          for (const [from, to, display] of [
            ["940GZZLUHSD", "940GZZLUACT", true],
            ["940GZZLUTNG", "940GZZLUACT", false],
            ["940GZZLUECT", "940GZZLUBSC", true],
          ] as const) {
            const shared = walk(from, to);
            if (!shared || shared.length < 2) continue;
            segments = [
              ...segments,
              { lineId: "piccadilly", fromStationId: from, toStationId: to, path: shared },
            ];
            if (display) {
              const fromStation = mapData.stations.find((station) => station.id === from);
              const toStation = mapData.stations.find((station) => station.id === to);
              displayedLinePaths.push({
                lineId: "piccadilly",
                path: [
                  ...(fromStation ? [fromStation.coordinates] : []),
                  ...shared,
                  ...(toStation ? [toStation.coordinates] : []),
                ],
              });
            }
          }
        }
        for (const connection of [
          {
            lineId: "district",
            fromStationId: "940GZZLUKOY",
            toStationId: "940GZZLUECT",
          },
          {
            lineId: "hammersmith-city",
            fromStationId: "940GZZLULVT",
            toStationId: "940GZZLUADE",
          },
        ] as const) {
          const hasConnection = (candidate: TrackSegment) =>
            candidate.lineId === connection.lineId &&
            ((candidate.fromStationId === connection.fromStationId &&
              candidate.toStationId === connection.toStationId) ||
              (candidate.fromStationId === connection.toStationId &&
                candidate.toStationId === connection.fromStationId));
          if (segments.some(hasConnection)) continue;

          try {
            const routeData = await fetchTfLRouteDataAllDirections(connection.lineId);
            if (cancelled) return;
            const routeSegment = routeData.segments.find(hasConnection);
            if (!routeSegment) {
              throw new Error(
                `TfL route data is missing the connection ${connection.fromStationId}-${connection.toStationId}`,
              );
            }
            const fromStation = routeData.stations.find(
              (station) => station.id === connection.fromStationId,
            );
            const toStation = routeData.stations.find(
              (station) => station.id === connection.toStationId,
            );
            if (!fromStation || !toStation) {
              throw new Error(
                `TfL route data is missing station geometry for ${connection.fromStationId}-${connection.toStationId}`,
              );
            }
            const realTrackPath = extractPathBetweenStations(
              await fetchOsmTubeBranchPaths(connection.lineId),
              fromStation,
              toStation,
            );
            if (!realTrackPath) {
              throw new Error(
                `OpenStreetMap track data is missing geometry for ${connection.fromStationId}-${connection.toStationId}`,
              );
            }
            for (const station of routeData.stations) {
              if (!stations.some((existing) => existing.id === station.id)) {
                stations.push(station);
              }
            }
            const [connectedSegment] = snapTrackSegmentsToStations(
              [{ ...routeSegment, path: realTrackPath }],
              stations,
            );
            if (!connectedSegment) {
              throw new Error(
                `Unable to connect ${connection.fromStationId} to ${connection.toStationId}`,
              );
            }
            segments.push(connectedSegment);
            displayedLinePaths.push({
              lineId: connectedSegment.lineId,
              path: connectedSegment.path,
            });
          } catch (routeError) {
            console.error(
              `Unable to load ${connection.lineId} connection ${connection.fromStationId}-${connection.toStationId}`,
              routeError,
            );
          }
        }
        try {
          const elizabethData = await fetchElizabethLineData();
          if (cancelled) return;
          elizabethSegments = elizabethData.segments;
          elizabethStations = elizabethData.stations;
          stations = [...stations, ...elizabethData.stations];
        } catch (routeError) {
          console.error("Unable to load Elizabeth line route", routeError);
        }
        for (const line of ["metropolitan", "dlr", "tram"] as const) {
          try {
            const routeData = await fetchTfLRouteDataAllDirections(line);
            if (cancelled) return;
            for (const station of routeData.stations) {
              if (!stations.some((existing) => existing.id === station.id)) {
                stations.push(station);
              }
            }
            if (line === "metropolitan") {
              segments = segments.filter((segment) => segment.lineId !== line);
              displayedLinePaths = displayedLinePaths.filter(
                (linePath) => linePath.lineId !== line,
              );
            }
            segments.push(...routeData.segments);
            try {
              const railPaths = await fetchOsmRailPaths(line);
              if (cancelled) return;
              railPathsByLine.set(line, railPaths);
              displayedLinePaths = displayedLinePaths.filter(
                (linePath) => linePath.lineId !== line,
              );
              displayedLinePaths.push(...railPaths.map((path) => ({ lineId: line, path })));
            } catch (railError) {
              console.error(`Unable to load ${line} rail geometry from local OSM data`, railError);
            }
          } catch (geomError) {
            console.error(`Unable to load ${line} geometry`, geomError);
          }
        }
        const overgroundRoutes = await Promise.all(
          OVERGROUND_LINE_IDS.map(async (lineId) => {
            try {
              const routeData = await fetchTfLRouteDataAllDirections(lineId);
              return { lineId, routeData };
            } catch (routeError) {
              console.error(`Unable to load ${lineId} route geometry`, routeError);
              return undefined;
            }
          }),
        );
        if (cancelled) return;
        const overgroundSegmentKeys = new Set<string>();
        const overgroundLinePaths: { lineId: string; path: Coordinate[] }[] = [];
        for (const route of overgroundRoutes) {
          if (!route) continue;
          const routeData = route.routeData;
          for (const station of routeData.stations) {
            if (!stations.some((existing) => existing.id === station.id)) {
              overgroundStationIds.add(station.id);
              stations.push(station);
            }
          }
          for (const segment of routeData.segments) {
            const endpointKey = [segment.fromStationId, segment.toStationId].sort().join(":");
            const key = `${route.lineId}:${endpointKey}`;
            if (overgroundSegmentKeys.has(key)) continue;
            overgroundSegmentKeys.add(key);
            overgroundSegments.push(segment);
          }
          let overgroundPaths = routeData.segments.map(({ path }) => path);
          try {
            const railPaths = await fetchOsmRailPaths(route.lineId as any);
            if (cancelled) return;
            if (railPaths.length > 0) {
              railPathsByLine.set(route.lineId, railPaths);
              overgroundPaths = railPaths;
            } else {
              console.warn(
                `No detailed OSM rail geometry found for ${route.lineId}; using TfL route geometry`,
              );
            }
          } catch (railError) {
            console.error(
              `Unable to load ${route.lineId} rail geometry from local OSM data`,
              railError,
            );
          }
          overgroundLinePaths.push(
            ...overgroundPaths.map((path) => ({ lineId: route.lineId, path })),
          );
        }
        segments = snapTrackSegmentsToStations(segments, stations);
        // Metropolitan, DLR and Tram use their real OSM track geometry, stitched from fragments into long continuous paths.
        const realTrackLines = new Set(["metropolitan", "dlr", "tram"]);
        displayedLinePaths = displayedLinePaths.flatMap((linePath) => {
          if (!realTrackLines.has(linePath.lineId)) return [linePath];
          return [];
        });
        for (const lineId of realTrackLines) {
          const railPaths = railPathsByLine.get(lineId);
          if (!railPaths) continue;
          const stationById = new Map(stations.map((station) => [station.id, station]));
          const pairs = segments
            .filter((segment) => segment.lineId === lineId)
            .flatMap((segment) => {
              const from = stationById.get(segment.fromStationId)?.coordinates;
              const to = stationById.get(segment.toStationId)?.coordinates;
              return from && to ? [{ from, to, fallback: segment.path }] : [];
            });
          const stationCoordinates = stations.map((station) => station.coordinates);
          const routed =
            pairs.length > 0
              ? routeThroughRail(railPaths, pairs)
              : cleanRailPaths(railPaths, stationCoordinates);
          displayedLinePaths.push(...routed.map((path) => ({ lineId, path })));
        }
        displayedLinePaths.push(
          ...getTrackEndpointConnectors(segments, 150)
            .filter(
              (segment) =>
                segment.lineId !== "metropolitan" &&
                segment.lineId !== "dlr" &&
                segment.lineId !== "tram",
            )
            .map(({ lineId, path }) => ({ lineId, path })),
        );
        stationNames = new Map(stations.map((station) => [station.id, station.name]));
        const stationLines = new Map<string, Set<string>>();
        for (const segment of [...segments, ...elizabethSegments, ...overgroundSegments]) {
          for (const stationId of [segment.fromStationId, segment.toStationId]) {
            const lines = stationLines.get(stationId) ?? new Set<string>();
            lines.add(segment.lineId);
            stationLines.set(stationId, lines);
          }
        }
        const stationLinesHtml = (stationIds: string[]) => {
          const lines = [
            ...new Set(stationIds.flatMap((stationId) => [...(stationLines.get(stationId) ?? [])])),
          ].sort();
          if (lines.length === 0) {
            return '<p class="station-accessibility__empty">Line information is not available.</p>';
          }
          return `<ul class="station-accessibility__lines">${lines.map(getLineBadgeHtml).join("")}</ul>`;
        };

        // Side-by-side spacing is real geometry sized to one drawn line width at the current zoom,
        // so lines never overlap when zoomed out and stay continuous.
        const slotMetresAt = (zoom: number) => {
          const widthPx =
            2.5 +
            (5.5 - 2.5) * Math.min(1, Math.max(0, (zoom - 11) / 3)) +
            (zoom > 14 ? (8 - 5.5) * Math.min(1, (zoom - 14) / 3) : 0);
          return (widthPx * 48750) / 2 ** zoom;
        };
        const spreadCache = new Map<number, ReturnType<typeof computeSpread>>();
        const preparedTube = prepareOverlappingLines([
          ...displayedLinePaths,
          ...elizabethSegments.map((segment) => ({ lineId: "elizabeth", path: segment.path })),
        ]);
        const preparedOverground = prepareOverlappingLines(overgroundLinePaths);
        function computeSpread(bucket: number) {
          const slot = slotMetresAt(bucket);
          return { tube: preparedTube.at(slot), overground: preparedOverground.at(slot) };
        }
        const spreadFor = (zoom: number) => {
          const bucket = Math.min(17, Math.max(10, Math.round(zoom * 2) / 2));
          let result = spreadCache.get(bucket);
          if (!result) {
            result = computeSpread(bucket);
            spreadCache.set(bucket, result);
          }
          return result;
        };
        // Warm the cache one zoom step at a time while idle so zooming never waits on computation.
        const warmBuckets = [
          10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17,
        ];
        const warmNext = () => {
          const bucket = warmBuckets.shift();
          if (bucket === undefined) return;
          spreadFor(bucket);
          setTimeout(warmNext, 30);
        };
        setTimeout(warmNext, 1500);
        const toFeatures = (list: { lineId: string; path: number[][] }[]) =>
          list.map((linePath) => ({
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates: linePath.path },
            properties: {
              color: LINE_COLOURS[linePath.lineId] ?? "#ffffff",
              lineId: linePath.lineId,
            },
          }));
        let appliedBucket = Math.round(map.getZoom() * 2) / 2;
        const applySpread = () => {
          appliedBucket = Math.round(map.getZoom() * 2) / 2;
          const spread = spreadFor(map.getZoom());
          const setData = (id: string, list: { lineId: string; path: number[][] }[]) =>
            (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData({
              type: "FeatureCollection",
              features: toFeatures(list),
            });
          setData(
            "tube-lines",
            spread.tube.filter((l) => l.lineId !== "elizabeth"),
          );
          setData(
            "elizabeth-line",
            spread.tube.filter((l) => l.lineId === "elizabeth"),
          );
          setData("overground-lines", spread.overground);
        };
        let spreadTimer: ReturnType<typeof setTimeout> | undefined;
        map.on("zoom", () => {
          if (Math.round(map.getZoom() * 2) / 2 === appliedBucket) return;
          clearTimeout(spreadTimer);
          spreadTimer = setTimeout(applySpread, 0);
        });
        const initialSpread = spreadFor(map.getZoom());
        const spreadTube = initialSpread.tube;
        const spreadOverground = initialSpread.overground;

        map.addSource("tube-lines", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: spreadTube
              .filter((linePath) => linePath.lineId !== "elizabeth")
              .map((linePath) => ({
                type: "Feature" as const,
                geometry: { type: "LineString" as const, coordinates: linePath.path },
                properties: {
                  color: LINE_COLOURS[linePath.lineId] ?? "#ffffff",
                  lineId: linePath.lineId,
                  offset: linePath.offset,
                },
              })),
          },
        });
        map.addLayer({
          id: "tube-lines-glow",
          type: "line",
          source: "tube-lines",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 11, 6, 14, 10, 17, 14],
            "line-opacity": 0.18,
            "line-blur": 3,
          },
        });
        map.addLayer({
          id: "tube-lines",
          type: "line",
          source: "tube-lines",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 14, 5.5, 17, 8],
          },
        });

        map.addSource("elizabeth-line", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: spreadTube
              .filter((linePath) => linePath.lineId === "elizabeth")
              .map((linePath) => ({
                type: "Feature" as const,
                geometry: { type: "LineString" as const, coordinates: linePath.path },
                properties: {
                  color: LINE_COLOURS["elizabeth"],
                  lineId: "elizabeth",
                  offset: linePath.offset,
                },
              })),
          },
        });
        map.addLayer({
          id: "elizabeth-line-glow",
          type: "line",
          source: "elizabeth-line",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 11, 6, 14, 10, 17, 14],
            "line-opacity": 0.18,
            "line-blur": 3,
          },
        });
        map.addLayer({
          id: "elizabeth-line",
          type: "line",
          source: "elizabeth-line",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 14, 5.5, 17, 8],
          },
        });

        map.addSource("overground-lines", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: spreadOverground.map((linePath) => ({
              type: "Feature" as const,
              geometry: { type: "LineString" as const, coordinates: linePath.path },
              properties: {
                color: LINE_COLOURS[linePath.lineId] ?? "#ffffff",
                lineId: linePath.lineId,
                offset: linePath.offset,
              },
            })),
          },
        });
        map.addLayer({
          id: "overground-lines-glow",
          type: "line",
          source: "overground-lines",
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: overgroundEnabledRef.current ? "visible" : "none",
          },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 11, 6, 14, 10, 17, 14],
            "line-opacity": 0.18,
            "line-blur": 3,
          },
        });
        map.addLayer({
          id: "overground-lines",
          type: "line",
          source: "overground-lines",
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: overgroundEnabledRef.current ? "visible" : "none",
          },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 14, 5.5, 17, 8],
          },
        });
        const stationMarkerGroups = groupStationMarkers(stations);
        const createStationMarkerFeature = (group: (typeof stationMarkerGroups)[number]) => {
          const allLines = new Set<string>();
          for (const sid of group.stationIds) {
            const lines = stationLines.get(sid);
            if (lines) {
              for (const lineId of lines) allLines.add(lineId);
            }
          }
          return {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: group.station.coordinates },
            properties: {
              id: group.station.id,
              name: group.station.name,
              linesHtml: stationLinesHtml(group.stationIds),
              html: `<strong>${escapeHtml(group.station.name)}</strong>`,
              interchange: allLines.size >= 2,
              lineCount: allLines.size,
            },
          };
        };
        map.addSource("stations", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: stationMarkerGroups
              .filter((group) => !group.stationIds.every((id) => overgroundStationIds.has(id)))
              .map(createStationMarkerFeature),
          },
        });
        map.addLayer({
          id: "stations",
          type: "circle",
          source: "stations",
          minzoom: 12,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 5, 14, 7.5, 17, 10],
            "circle-color": "rgba(250, 248, 239, 0.2)",
            "circle-stroke-color": "#494b45",
            "circle-stroke-width": 2,
          },
        });

        map.addSource("overground-stations", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: stationMarkerGroups
              .filter((group) => group.stationIds.every((id) => overgroundStationIds.has(id)))
              .map(createStationMarkerFeature),
          },
        });
        map.addLayer({
          id: "overground-stations",
          type: "circle",
          source: "overground-stations",
          minzoom: 12,
          layout: { visibility: overgroundEnabledRef.current ? "visible" : "none" },
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 5, 14, 7.5, 17, 10],
            "circle-color": "rgba(250, 248, 239, 0.2)",
            "circle-stroke-color": "#494b45",
            "circle-stroke-width": 2,
          },
        });

        map.addSource("trains", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "trains-halo",
          type: "circle",
          source: "trains",
          paint: {
            "circle-radius": 12,
            "circle-color": ["get", "color"],
            "circle-opacity": 0.3,
            "circle-blur": 0.8,
          },
        });
        map.addLayer({
          id: "trains",
          type: "circle",
          source: "trains",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 14, 6, 17, 9],
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#fffdf5",
            "circle-stroke-width": 1.5,
          },
        });

        map.addSource("elizabeth-trains", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "elizabeth-trains-halo",
          type: "circle",
          source: "elizabeth-trains",
          paint: {
            "circle-radius": 12,
            "circle-color": ["get", "color"],
            "circle-opacity": 0.3,
            "circle-blur": 0.8,
          },
        });
        map.addLayer({
          id: "elizabeth-trains",
          type: "circle",
          source: "elizabeth-trains",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 14, 6, 17, 9],
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#fffdf5",
            "circle-stroke-width": 1.5,
          },
        });

        map.addSource("line-trains", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "line-trains-halo",
          type: "circle",
          source: "line-trains",
          paint: {
            "circle-radius": 12,
            "circle-color": ["get", "color"],
            "circle-opacity": 0.3,
            "circle-blur": 0.8,
          },
        });
        map.addLayer({
          id: "line-trains",
          type: "circle",
          source: "line-trains",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 14, 6, 17, 9],
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#fffdf5",
            "circle-stroke-width": 1.5,
          },
        });

        map.addSource("overground-trains", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "overground-trains-halo",
          type: "circle",
          source: "overground-trains",
          layout: { visibility: overgroundEnabledRef.current ? "visible" : "none" },
          paint: {
            "circle-radius": 12,
            "circle-color": ["get", "color"],
            "circle-opacity": 0.3,
            "circle-blur": 0.8,
          },
        });
        map.addLayer({
          id: "overground-trains",
          type: "circle",
          source: "overground-trains",
          layout: { visibility: overgroundEnabledRef.current ? "visible" : "none" },
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 14, 6, 17, 9],
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#fffdf5",
            "circle-stroke-width": 1.5,
          },
        });

        const trainLayerIds = ["trains", "elizabeth-trains", "overground-trains", "line-trains"];
        const lineFilterLayerIds = [
          "tube-lines-glow",
          "tube-lines",
          "elizabeth-line-glow",
          "elizabeth-line",
          "overground-lines-glow",
          "overground-lines",
          "trains-halo",
          "trains",
          "elizabeth-trains-halo",
          "elizabeth-trains",
          "line-trains-halo",
          "line-trains",
          "overground-trains-halo",
          "overground-trains",
        ];
        applyLineFilterRef.current = () => {
          const hidden = hiddenLinesRef.current;
          for (const layerId of lineFilterLayerIds) {
            if (!map.getLayer(layerId)) continue;
            map.setFilter(
              layerId,
              hidden.length > 0 ? ["!", ["in", ["get", "lineId"], ["literal", hidden]]] : null,
            );
          }
          // While a journey is shown, hide every other line, station and train.
          const journeyActive = journeyActiveRef.current;
          for (const layerId of [...lineFilterLayerIds, "stations", "overground-stations"]) {
            if (!map.getLayer(layerId)) continue;
            const isOverground = layerId.startsWith("overground");
            map.setLayoutProperty(
              layerId,
              "visibility",
              !journeyActive && (!isOverground || overgroundEnabledRef.current)
                ? "visible"
                : "none",
            );
          }
        };
        applyLineFilterRef.current();
        let hoveredTrainPoint: [number, number] | null = null;
        let hoveredTrainHtml = "";
        const updateHoveredTrainPopup = () => {
          if (!hoveredTrainPoint || stationPopup.isOpen()) return;
          const train = map.queryRenderedFeatures(hoveredTrainPoint, {
            layers: trainLayerIds,
          })[0];
          const html = train?.properties["html"];
          if (typeof html !== "string") {
            hoveredTrainHtml = "";
            popup.remove();
            return;
          }
          if (hoveredTrainHtml !== html) {
            popup.setHTML(html);
            hoveredTrainHtml = html;
            popup.setLngLat(map.unproject(hoveredTrainPoint)).addTo(map);
          } else if (hoveredTrainPoint) {
            popup.setLngLat(map.unproject(hoveredTrainPoint)).addTo(map);
          }
        };
        map.on("render", updateHoveredTrainPopup);
        map.on("mousemove", (event: maplibregl.MapMouseEvent) => {
          const features = map.queryRenderedFeatures(event.point, {
            layers: [
              "stations",
              "overground-stations",
              ...trainLayerIds,
              "tube-lines",
              "elizabeth-line",
              "overground-lines",
            ],
          });
          const feature =
            features.find((candidate) => candidate.layer.id === "stations") ??
            features.find((candidate) => candidate.layer.id === "overground-stations") ??
            features.find((candidate) => candidate.layer.id === "trains") ??
            features.find((candidate) => candidate.layer.id === "elizabeth-trains") ??
            features.find((candidate) => candidate.layer.id === "overground-trains") ??
            features.find((candidate) => candidate.layer.id === "line-trains") ??
            features.find((candidate) => candidate.layer.id === "tube-lines") ??
            features.find((candidate) => candidate.layer.id === "elizabeth-line") ??
            features.find((candidate) => candidate.layer.id === "overground-lines");
          if (!feature) {
            hoveredTrainPoint = null;
            hoveredTrainHtml = "";
            map.getCanvas().style.cursor = "";
            popup.remove();
            return;
          }
          map.getCanvas().style.cursor = "pointer";
          if (feature.layer.id === "stations" || feature.layer.id === "overground-stations") {
            hoveredTrainPoint = null;
            hoveredTrainHtml = "";
            if (selectedStationId === String(feature.properties["id"])) {
              popup.remove();
              return;
            }
            const stationName = escapeHtml(String(feature.properties["name"]));
            const linesHtml = String(feature.properties["linesHtml"]);
            popup
              .setLngLat(event.lngLat)
              .setHTML(
                `<section class="station-accessibility"><p class="station-accessibility__eyebrow">Station</p><h2 class="station-accessibility__title">${stationName}</h2><p class="station-accessibility__section-title">Lines serving this station</p>${linesHtml}<p class="station-accessibility__source">Click for station information and accessibility details</p></section>`,
              )
              .addTo(map);
            return;
          }
          if (
            feature.layer.id === "tube-lines" ||
            feature.layer.id === "elizabeth-line" ||
            feature.layer.id === "overground-lines"
          ) {
            hoveredTrainPoint = null;
            hoveredTrainHtml = "";
            if (stationPopup.isOpen()) {
              popup.remove();
              return;
            }
            const lineId = String(feature.properties["lineId"] ?? "");
            popup
              .setLngLat(event.lngLat)
              .setHTML(
                `<section class="station-accessibility station-accessibility--compact"><ul class="station-accessibility__lines">${getLineBadgeHtml(lineId)}</ul></section>`,
              )
              .addTo(map);
            return;
          }
          hoveredTrainPoint = [event.point.x, event.point.y];
          hoveredTrainHtml = String(feature.properties["html"]);
          if (stationPopup.isOpen()) {
            popup.remove();
            return;
          }
          popup.setLngLat(event.lngLat).setHTML(String(feature.properties["html"])).addTo(map);
        });
        map.on("click", (event: maplibregl.MapMouseEvent) => {
          const station = map.queryRenderedFeatures(event.point, {
            layers: ["stations", "overground-stations"],
          })[0];
          if (!station) {
            selectedStationId = "";
            stationPopup.remove();
            popup.remove();
            return;
          }

          const stationId = String(station.properties["id"]);
          const stationName = String(station.properties["name"]);
          const linesHtml = String(station.properties["linesHtml"]);
          selectedStationId = stationId;
          popup.remove();
          stationPopup
            .setLngLat(event.lngLat)
            .setHTML(
              `<section class="station-accessibility"><p class="station-accessibility__eyebrow">Station information</p><h2 class="station-accessibility__title">${escapeHtml(stationName)}</h2><p class="station-accessibility__section-title">Lines serving this station</p>${linesHtml}<p class="station-accessibility__source">Accessibility information reported by TfL</p><p class="station-accessibility__loading">Loading TfL information…</p></section>`,
            )
            .addTo(map);

          let accessibilityRequest = stationAccessibilityCache.get(stationId);
          if (!accessibilityRequest) {
            accessibilityRequest = fetchStationAccessibility(stationId);
            stationAccessibilityCache.set(stationId, accessibilityRequest);
            void accessibilityRequest.catch(() => {
              if (stationAccessibilityCache.get(stationId) === accessibilityRequest) {
                stationAccessibilityCache.delete(stationId);
              }
            });
          }
          void accessibilityRequest.then(
            (items) => {
              if (selectedStationId !== stationId || !stationPopup.isOpen()) return;
              stationPopup.setHTML(stationAccessibilityHtml(stationName, linesHtml, items));
            },
            (accessibilityError: unknown) => {
              console.error(
                `Unable to load accessibility details for ${stationName}`,
                accessibilityError,
              );
              if (selectedStationId !== stationId || !stationPopup.isOpen()) return;
              stationPopup.setHTML(
                `<section class="station-accessibility"><p class="station-accessibility__eyebrow">Station information</p><h2 class="station-accessibility__title">${escapeHtml(stationName)}</h2><p class="station-accessibility__section-title">Lines serving this station</p>${linesHtml}<p class="station-accessibility__source">Accessibility information reported by TfL</p><p class="station-accessibility__error">Accessibility information could not be loaded. Please try again.</p></section>`,
              );
            },
          );
        });
        map.on("mouseout", () => {
          hoveredTrainPoint = null;
          hoveredTrainHtml = "";
          map.getCanvas().style.cursor = "";
          popup.remove();
        });

        try {
          trainActions = await fetchTrainActions();
          updateTrainPositions();
        } catch (feedError) {
          console.error("Unable to load live train positions", feedError);
          setError("Live train positions are currently unavailable.");
        }

        try {
          elizabethArrivals = await fetchElizabethLineArrivals();
          elizabethArrivalsFetchedAt = Date.now();
          updateElizabethLineTrainPositions();
        } catch (feedError) {
          console.error("Unable to load Elizabeth line train positions", feedError);
        }
        try {
          lineArrivals = await fetchLineArrivals();
          lineArrivalsFetchedAt = Date.now();
          updateLineTrainPositions();
        } catch (feedError) {
          console.error("Unable to load DLR/Tram train positions", feedError);
        }
        try {
          overgroundArrivals = await fetchOvergroundArrivals();
          overgroundArrivalsFetchedAt = Date.now();
          updateOvergroundTrainPositions();
        } catch (feedError) {
          console.error("Unable to load Overground train positions", feedError);
        }
        if (cancelled) return;
        let lastPositionUpdate = 0;
        const animateTrainPositions = (timestamp: number) => {
          if (timestamp - lastPositionUpdate >= 1000 / 60) {
            updateTrainPositions();
            updateElizabethLineTrainPositions();
            updateLineTrainPositions();
            updateOvergroundTrainPositions();
            lastPositionUpdate = timestamp;
          }
          animationFrame = requestAnimationFrame(animateTrainPositions);
        };
        animationFrame = requestAnimationFrame(animateTrainPositions);

        actionRefreshTimer = setInterval(async () => {
          try {
            trainActions = await fetchTrainActions();
            setError(null);
            updateTrainPositions();
          } catch (feedError) {
            console.error("Unable to refresh live train positions", feedError);
            setError("Live train positions could not be refreshed.");
          }
          try {
            elizabethArrivals = await fetchElizabethLineArrivals();
            elizabethArrivalsFetchedAt = Date.now();
            updateElizabethLineTrainPositions();
          } catch (feedError) {
            console.error("Unable to refresh Elizabeth line train positions", feedError);
          }
          try {
            lineArrivals = await fetchLineArrivals();
            lineArrivalsFetchedAt = Date.now();
            updateLineTrainPositions();
          } catch (feedError) {
            console.error("Unable to refresh DLR/Tram train positions", feedError);
          }
          try {
            overgroundArrivals = await fetchOvergroundArrivals();
            overgroundArrivalsFetchedAt = Date.now();
            updateOvergroundTrainPositions();
          } catch (feedError) {
            console.error("Unable to refresh Overground train positions", feedError);
          }
        }, 30_000);
      } catch (mapError) {
        console.error("Unable to load the tube map data", mapError);
        setError("The map or its track data could not be loaded.");
      }
    };

    map.on("load", handleMapLoad);

    return () => {
      cancelled = true;
      setIsMapReady(false);
      if (actionRefreshTimer) clearInterval(actionRefreshTimer);
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      const center = map.getCenter();
      if (mapRef.current === map) mapRef.current = null;
      cameraRef.current = {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      };
      map.remove();
    };
  }, [isDark]);

  return (
    <>
      <div ref={ref} className="absolute inset-0 h-full w-full" />
      {error && (
        <div
          className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-md bg-white/95 px-3 py-2 text-center font-mono text-xs text-red-700 shadow"
          role="alert"
        >
          {error}
        </div>
      )}
    </>
  );
}
