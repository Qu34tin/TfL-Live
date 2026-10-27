import { LINE_COLOURS } from "@/lib/tfl";
import type { TrainPosition } from "@/lib/tube-train-map";

export function escapeHtml(value: string): string {
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

function formatTrainTime(timestampSeconds: number, now: Date): string {
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(utcMidnight + timestampSeconds * 1000).toLocaleTimeString("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatLineName(lineId: string): string {
  return lineId
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" & ");
}

export function buildTrainTooltipHtml(
  train: TrainPosition,
  stationNames: Map<string, string>,
  now = new Date(),
): string {
  const color = LINE_COLOURS[train.lineId] ?? "#ffffff";
  const fromName = train.routeStartStationId ? (stationNames.get(train.routeStartStationId) ?? train.routeStartStationId) : (stationNames.get(train.fromStationId) ?? train.fromStationId);
  const toName = train.routeEndStationId ? (stationNames.get(train.routeEndStationId) ?? train.routeEndStationId) : (stationNames.get(train.toStationId) ?? train.toStationId);
  const futureStops = train.futureStops
    .map(
      (stop) =>
        `<li><time>${formatTrainTime(stop.arrivalTimestamp, now)}</time> – ${escapeHtml(stop.stationName)}</li>`,
    )
    .join("");

  return `<article class="train-tooltip"><h3 style="color:${color}">${escapeHtml(formatLineName(train.lineId))} Train ${escapeHtml(train.trainId)}</h3><p><strong>From:</strong> ${escapeHtml(fromName)}</p><p><strong>To:</strong> ${escapeHtml(toName)}</p><p><strong>Progress:</strong> ${train.progressPercent.toFixed(1)}%</p><div class="train-tooltip__progress"><span style="width:${train.progressPercent}%;background:${color}"></span></div>${futureStops ? `<h4>Future Stops:</h4><ul>${futureStops}</ul>` : ""}</article>`;
}
