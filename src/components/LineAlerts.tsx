import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { fetchLineStatus, type LineStatus } from "@/lib/tfl";
import { readStored, STORAGE_KEYS } from "@/lib/storage";

type Alert = { id: string; title: string; body: string };

export function detectStatusChanges(
  previous: Record<string, string>,
  lines: LineStatus[],
  watched: string[],
): { alerts: Alert[]; next: Record<string, string> } {
  const next: Record<string, string> = {};
  const alerts: Alert[] = [];
  for (const line of lines) {
    const status = line.lineStatuses[0];
    if (!status) continue;
    next[line.id] = status.statusSeverityDescription;
    if (!watched.includes(line.id)) continue;
    const before = previous[line.id];
    if (before !== undefined && before !== status.statusSeverityDescription) {
      alerts.push({
        id: `${line.id}:${status.statusSeverityDescription}`,
        title: `${line.name}: ${status.statusSeverityDescription}`,
        body: status.reason ?? `Was ${before}.`,
      });
    }
  }
  return { alerts, next };
}

/** Polls watched lines and surfaces status changes in-app and via browser notifications. */
export default function LineAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const previous = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const watched = readStored<string[]>(STORAGE_KEYS.watchedLines, []);
      if (watched.length === 0) {
        previous.current = {};
        return;
      }
      try {
        const lines = await fetchLineStatus();
        if (cancelled) return;
        const { alerts: fresh, next } = detectStatusChanges(previous.current, lines, watched);
        previous.current = next;
        if (fresh.length === 0) return;
        setAlerts((current) => [
          ...fresh,
          ...current.filter((a) => !fresh.some((f) => f.id === a.id)),
        ]);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          for (const alert of fresh) new Notification(alert.title, { body: alert.body });
        }
      } catch {
        // Try again on the next poll.
      }
    };
    void check();
    const timer = window.setInterval(check, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (alerts.length === 0) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {alerts.slice(0, 3).map((alert) => (
        <div
          key={alert.id}
          className="flex items-start gap-3 rounded-xl border border-border bg-popover p-3 shadow-2xl"
        >
          <Bell size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">{alert.title}</p>
            <p className="mt-0.5 line-clamp-3 text-muted-foreground">{alert.body}</p>
          </div>
          <button
            type="button"
            aria-label="Dismiss alert"
            onClick={() => setAlerts((current) => current.filter((a) => a.id !== alert.id))}
            className="rounded-full p-1 text-muted-foreground hover:bg-secondary"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
