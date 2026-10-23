import type { StyleSpecification } from "maplibre-gl";

const mapColors = {
  light: {
    background: "#f5f0d9",
    parks: "#dff0d7",
    water: "#e8e0c0",
    buildings: "#d8d2be",
    buildingOutline: "#c8c0aa",
    buildings3d: "#8eddbb",
    minorRoads: "#d9d0b3",
    majorRoads: "#c5b99c",
    roadLabels: "#777365",
    placeLabels: "#34332d",
    labelHalo: "rgba(245, 240, 217, 0.9)",
  },
  dark: {
    background: "#111820",
    parks: "#24372e",
    water: "#182a36",
    buildings: "#30383d",
    buildingOutline: "#414a50",
    buildings3d: "#304d47",
    minorRoads: "#343d40",
    majorRoads: "#465155",
    roadLabels: "#aeb9b9",
    placeLabels: "#e4e6dc",
    labelHalo: "rgba(17, 24, 32, 0.9)",
  },
} as const;

export function createMapTilerStyle(apiKey: string, isDark = false): StyleSpecification {
  const encodedKey = encodeURIComponent(apiKey);
  const colors = mapColors[isDark ? "dark" : "light"];
  const style: StyleSpecification = {
    version: 8,
    name: "London Underground Live",
    glyphs: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${encodedKey}`,
    sources: {
      maptiler: {
        type: "vector",
        tiles: [`https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=${encodedKey}`],
        minzoom: 0,
        maxzoom: 14,
        attribution:
          '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>',
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": colors.background },
      },
      {
        id: "parks",
        type: "fill",
        source: "maptiler",
        "source-layer": "landuse",
        filter: ["in", ["get", "class"], ["literal", ["park", "grass", "garden"]]],
        paint: { "fill-color": colors.parks, "fill-opacity": 0.8 },
      },
      {
        id: "water",
        type: "fill",
        source: "maptiler",
        "source-layer": "water",
        paint: { "fill-color": colors.water },
      },
      {
        id: "building-footprints",
        type: "fill",
        source: "maptiler",
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-color": colors.buildings,
          "fill-outline-color": colors.buildingOutline,
        },
      },
      {
        id: "buildings-3d",
        type: "fill-extrusion",
        source: "maptiler",
        "source-layer": "building",
        minzoom: 13,
        filter: ["!=", ["get", "hide_3d"], true],
        paint: {
          "fill-extrusion-color": colors.buildings3d,
          "fill-extrusion-opacity": 0.45,
          "fill-extrusion-height": [
            "interpolate",
            ["linear"],
            ["zoom"],
            13,
            0,
            15,
            ["coalesce", ["get", "render_height"], 10],
          ],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        },
      },
      {
        id: "minor-roads",
        type: "line",
        source: "maptiler",
        "source-layer": "transportation",
        filter: ["all", ["!=", ["get", "class"], "motorway"], ["!=", ["get", "class"], "trunk"]],
        paint: {
          "line-color": colors.minorRoads,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.35, 16, 1.5],
        },
      },
      {
        id: "major-roads",
        type: "line",
        source: "maptiler",
        "source-layer": "transportation",
        filter: [
          "in",
          ["get", "class"],
          ["literal", ["motorway", "trunk", "primary", "secondary"]],
        ],
        paint: {
          "line-color": colors.majorRoads,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 16, 3],
        },
      },
      {
        id: "road-labels",
        type: "symbol",
        source: "maptiler",
        "source-layer": "transportation_name",
        minzoom: 14,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10,
          "symbol-placement": "line",
        },
        paint: {
          "text-color": colors.roadLabels,
          "text-halo-color": colors.background,
          "text-halo-width": 1,
        },
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "maptiler",
        "source-layer": "place",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 15, 13],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.08,
          "text-max-width": 8,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": colors.placeLabels,
          "text-halo-color": colors.labelHalo,
          "text-halo-width": 1.2,
        },
      },
    ],
  };

  return style;
}
