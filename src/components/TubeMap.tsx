import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { createMapTilerStyle } from "@/lib/maptiler-style";
import {
  fetchElizabethLineArrivals,
  fetchElizabethLineData,
  fetchOsmRailPaths,
  fetchTfLRouteData,
  fetchTrainActions,
  fetchTubeMapData,
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
import {
  LINE_COLOURS,
  OVERGROUND_LINE_IDS,
  fetchLineArrivals,
  fetchOvergroundArrivals,
  fetchStationAccessibility,
  type StationAccessibilityItem,
  type LineArrival,
} from "@/lib/tfl";

export default function TubeMap({ overgroundEnabled }: { overgroundEnabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overgroundEnabledRef = useRef(overgroundEnabled);
  const cameraRef = useRef<{
    center: [number, number];
    zoom: number;
    pitch: number;
    bearing: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

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
    overgroundEnabledRef.current = overgroundEnabled;
    const map = mapRef.current;
    if (!map) return;
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
      zoom: camera?.zoom ?? 14,
      pitch: camera?.pitch ?? 50,
      bearing: camera?.bearing ?? 0,
      maxPitch: 75,
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
      try {
        const mapData = await fetchTubeMapData();
        if (cancelled) return;
        stations = mapData.stations;
        segments = mapData.segments;
        displayedLinePaths = mapData.segments.map(({ lineId, path }) => ({ lineId, path }));
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
            const routeData = await fetchTfLRouteData(line);
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
              const routeData = await fetchTfLRouteData(lineId, "outbound");
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
        displayedLinePaths.push(
          ...getTrackEndpointConnectors(segments)
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
          const labels: Record<string, string> = {
            "hammersmith-city": "Hammersmith & City",
            dlr: "DLR",
            tram: "Tram",
          };
          return `<ul class="station-accessibility__lines">${lines
            .map((lineId) => {
              const label =
                labels[lineId] ??
                `${lineId
                  .split("-")
                  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                  .join(" ")} line`;
              const color = LINE_COLOURS[lineId] ?? "#64748b";
              const textColor = lineId === "circle" ? "#1f2937" : "#ffffff";
              return `<li class="station-accessibility__line" style="--line-color:${color};--line-text-color:${textColor}">${escapeHtml(label)}</li>`;
            })
            .join("")}</ul>`;
        };

        map.addSource("tube-lines", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: displayedLinePaths.map((linePath) => ({
              type: "Feature" as const,
              geometry: { type: "LineString" as const, coordinates: linePath.path },
              properties: { color: LINE_COLOURS[linePath.lineId] ?? "#ffffff", lineId: linePath.lineId },
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
            features: elizabethSegments.map((segment) => ({
              type: "Feature" as const,
              geometry: { type: "LineString" as const, coordinates: segment.path },
              properties: { color: LINE_COLOURS["elizabeth"], lineId: "elizabeth" },
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
            features: overgroundLinePaths.map((linePath) => ({
              type: "Feature" as const,
              geometry: { type: "LineString" as const, coordinates: linePath.path },
              properties: { color: LINE_COLOURS[linePath.lineId] ?? "#ffffff", lineId: linePath.lineId },
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
        const createStationMarkerFeature = (group: (typeof stationMarkerGroups)[number]) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: group.station.coordinates },
          properties: {
            id: group.station.id,
            name: group.station.name,
            linesHtml: stationLinesHtml(group.stationIds),
            html: `<strong>${escapeHtml(group.station.name)}</strong>`,
          },
        });
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
            layers: ["stations", "overground-stations", ...trainLayerIds, "tube-lines", "elizabeth-line", "overground-lines"],
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
            popup.setLngLat(event.lngLat).setHTML(`<article class="train-tooltip"><h3>${escapeHtml(String(feature.properties["name"]))}</h3></article>`).addTo(map);
            return;
          }
          if (feature.layer.id === "tube-lines" || feature.layer.id === "elizabeth-line" || feature.layer.id === "overground-lines") {
            hoveredTrainPoint = null;
            hoveredTrainHtml = "";
            if (stationPopup.isOpen()) {
              popup.remove();
              return;
            }
            const lineId = feature.properties["lineId"] || feature.properties["color"];
            const lineName = lineId
              .toString()
              .split("-")
              .map((part: string) => part[0]?.toUpperCase() + part.slice(1))
              .join(" & ");
            popup.setLngLat(event.lngLat).setHTML(`<article class="train-tooltip"><h3>${escapeHtml(lineName)}${lineName.includes("line") ? "" : " line"}</h3></article>`).addTo(map);
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
