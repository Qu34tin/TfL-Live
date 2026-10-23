import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createMapTilerStyle } from "@/lib/maptiler-style";
import {
  fetchElizabethLineArrivals,
  fetchElizabethLineData,
  fetchOsmRailPaths,
  fetchTfLRouteData,
  fetchTrainActions,
  fetchTubeMapData,
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
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

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

          return {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: train.coordinates },
            properties: {
              color,
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
          geometry: { type: "Point" as const, coordinates: train.coordinates },
          properties: {
            color: LINE_COLOURS[train.lineId] ?? "#ffffff",
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
          overgroundLinePaths.push(
            ...routeData.segments.map(({ path }) => ({ lineId: route.lineId, path })),
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

        map.addSource("tube-lines", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: displayedLinePaths.map((linePath) => ({
              type: "Feature" as const,
              geometry: { type: "LineString" as const, coordinates: linePath.path },
              properties: { color: LINE_COLOURS[linePath.lineId] ?? "#ffffff" },
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
              properties: { color: LINE_COLOURS["elizabeth"] },
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
              properties: { color: LINE_COLOURS[linePath.lineId] ?? "#ffffff" },
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

        map.addSource("stations", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: stations
              .filter((station) => !overgroundStationIds.has(station.id))
              .map((station) => ({
                type: "Feature" as const,
                geometry: { type: "Point" as const, coordinates: station.coordinates },
                properties: {
                  name: station.name,
                  html: `<strong>${escapeHtml(station.name)}</strong>`,
                },
              })),
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
            features: stations
              .filter((station) => overgroundStationIds.has(station.id))
              .map((station) => ({
                type: "Feature" as const,
                geometry: { type: "Point" as const, coordinates: station.coordinates },
                properties: {
                  name: station.name,
                  html: `<strong>${escapeHtml(station.name)}</strong>`,
                },
              })),
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

        map.on("mousemove", (event: maplibregl.MapMouseEvent) => {
          const features = map.queryRenderedFeatures(event.point, {
            layers: [
              "trains",
              "elizabeth-trains",
              "overground-trains",
              "line-trains",
              "stations",
              "overground-stations",
            ],
          });
          const feature =
            features.find((candidate) => candidate.layer.id === "trains") ??
            features.find((candidate) => candidate.layer.id === "elizabeth-trains") ??
            features.find((candidate) => candidate.layer.id === "overground-trains") ??
            features.find((candidate) => candidate.layer.id === "line-trains") ??
            features.find((candidate) => candidate.layer.id === "stations") ??
            features.find((candidate) => candidate.layer.id === "overground-stations");
          if (!feature) {
            map.getCanvas().style.cursor = "";
            popup.remove();
            return;
          }
          map.getCanvas().style.cursor = "pointer";
          popup.setLngLat(event.lngLat).setHTML(String(feature.properties["html"])).addTo(map);
        });
        map.on("mouseout", () => {
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
          if (timestamp - lastPositionUpdate >= 1000 / 30) {
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
