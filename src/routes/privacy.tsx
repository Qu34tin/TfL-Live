import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { STORAGE_KEYS } from "@/lib/storage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy · TfL-Live" },
      {
        name: "description",
        content:
          "What this site stores on your device, which third-party services it contacts, and the terms of use.",
      },
    ],
  }),
  component: PrivacyPage,
});

const THIRD_PARTIES = [
  {
    name: "Transport for London Open Data API",
    host: "api.tfl.gov.uk",
    why: "Line status, arrivals, journeys, fares and crowding. Station names and journey endpoints you search for are sent here.",
  },
  {
    name: "londonunderground.live",
    host: "londonunderground.live",
    why: "Train position data used for the live map.",
  },
  {
    name: "MapTiler / OpenStreetMap",
    host: "api.maptiler.com",
    why: "Map tiles and labels. Your browser requests tiles for the area you view, which reveals the map area and your IP address.",
  },
  {
    name: "Google Fonts",
    host: "fonts.googleapis.com",
    why: "Web fonts. Your IP address is visible to Google when fonts load.",
  },
  {
    name: "Apple Maps / Google Maps",
    host: "maps.apple.com, google.com/maps",
    why: "Only contacted if you press the open-in-maps button; the journey start and end are passed in the link.",
  },
];

function PrivacyPage() {
  const [cleared, setCleared] = useState(false);

  const clearData = () => {
    for (const key of Object.values(STORAGE_KEYS)) localStorage.removeItem(key);
    setCleared(true);
  };

  const exportData = () => {
    const data: Record<string, unknown> = { exportedAt: new Date().toISOString() };
    for (const key of Object.values(STORAGE_KEYS)) {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      try {
        data[key] = JSON.parse(raw);
      } catch {
        data[key] = raw;
      }
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "tfl-live-my-data.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-3xl space-y-10 px-5 py-10">
        <header>
          <h1 className="font-display text-3xl font-bold">Privacy, data &amp; terms</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Short version: no accounts, no ads, no analytics, no tracking cookies. Everything you
            save stays in your browser.
          </p>
        </header>

        <section aria-labelledby="stored" className="space-y-3">
          <h2 id="stored" className="font-display text-xl font-semibold">
            What is stored on your device
          </h2>
          <p className="text-sm text-muted-foreground">
            These items are used only to make the site work. They never leave your device and no
            consent banner is needed for them.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Favourite and recent stations, and recent journeys.</li>
            <li>Lines you chose to get alerts for.</li>
            <li>Your light/dark theme.</li>
            <li>An offline cache of the app shell (service worker). Live data is never cached.</li>
          </ul>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={exportData}
              className="rounded-full border border-border px-4 py-1.5 text-sm font-medium transition-colors hover:bg-secondary"
            >
              Download my data
            </button>
            <button
              type="button"
              onClick={clearData}
              className="rounded-full border border-border px-4 py-1.5 text-sm font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Delete my saved data
            </button>
            <p role="status" className="text-sm text-muted-foreground">
              {cleared ? "Saved stations, journeys and alert settings were deleted." : ""}
            </p>
          </div>
        </section>

        <section aria-labelledby="permissions" className="space-y-3">
          <h2 id="permissions" className="font-display text-xl font-semibold">
            Permissions you control
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              <strong>Location:</strong> only requested when you press “My location” or “Stations
              near me”. It is used in your browser to find nearby stations or as a journey start and
              is not stored.
            </li>
            <li>
              <strong>Notifications:</strong> only requested when you turn on a line alert. You can
              revoke this in your browser settings at any time.
            </li>
          </ul>
        </section>

        <section aria-labelledby="retention" className="space-y-3">
          <h2 id="retention" className="font-display text-xl font-semibold">
            Data retention
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              Saved stations, journeys and alert settings stay on your device until you delete them
              here or clear your browser data. Recent lists are capped at a few entries.
            </li>
            <li>The site has no server-side database, so we keep no copy of this data.</li>
            <li>Live data is never stored; it is fetched fresh and kept only in memory.</li>
            <li>
              Hosting providers may keep standard server logs (IP address, time, page) for a short
              period for security and reliability.
            </li>
          </ul>
        </section>

        <section aria-labelledby="not" className="space-y-3">
          <h2 id="not" className="font-display text-xl font-semibold">
            What this site does not do
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>No accounts or registration, so no passwords or profiles.</li>
            <li>No payments, subscriptions, automatic renewals or hidden fees. It is free.</li>
            <li>No advertising, marketing emails, countdown timers or other urgency tactics.</li>
            <li>No analytics or tracking SDKs, and no sale or sharing of data.</li>
            <li>
              No AI-generated content: all information comes from TfL and other sources listed
              below, and no data here is used to train AI models.
            </li>
            <li>It is not aimed at children and collects no personal data from anyone.</li>
          </ul>
        </section>

        <section aria-labelledby="third" className="space-y-3">
          <h2 id="third" className="font-display text-xl font-semibold">
            Third-party services
          </h2>
          <p className="text-sm text-muted-foreground">
            Your browser contacts these services directly. Each one sees your IP address and browser
            details, as with any website.
          </p>
          <ul className="space-y-3">
            {THIRD_PARTIES.map((party) => (
              <li key={party.name} className="rounded-xl border border-border bg-card p-3 text-sm">
                <p className="font-semibold">
                  {party.name}{" "}
                  <span className="font-mono text-xs font-normal text-muted-foreground">
                    {party.host}
                  </span>
                </p>
                <p className="mt-1 text-muted-foreground">{party.why}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="terms" className="space-y-3">
          <h2 id="terms" className="font-display text-xl font-semibold">
            Terms &amp; disclaimer
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              This is an unofficial project and is not affiliated with or endorsed by Transport for
              London.
            </li>
            <li>
              Live data may be delayed, incomplete or wrong. Do not rely on it for safety-critical
              decisions; check station announcements and official TfL sources.
            </li>
            <li>
              Contains public sector information licensed under the Open Government Licence v3.0,
              powered by TfL Open Data. Map data © MapTiler and OpenStreetMap contributors.
            </li>
            <li>The site is provided as is, without warranty.</li>
            <li>
              No uptime guarantee: the site is run on a best-effort basis and depends on TfL and map
              services being available.
            </li>
          </ul>
        </section>

        <section aria-labelledby="licences" className="space-y-3">
          <h2 id="licences" className="font-display text-xl font-semibold">
            Licences &amp; credits
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              Track geometry is derived from OpenStreetMap (© OpenStreetMap contributors, Open
              Database License 1.0) and adapted from pengrubin/london-live-2d.
            </li>
            <li>
              Fonts: Bricolage Grotesque and JetBrains Mono, both under the SIL Open Font License.
            </li>
            <li>Icons: Lucide (ISC licence). Map rendering: MapLibre GL (BSD-3-Clause).</li>
            <li>The Transport for London name and roundel are not used as a logo on this site.</li>
          </ul>
        </section>

        <section aria-labelledby="accessibility" className="space-y-2">
          <h2 id="accessibility" className="font-display text-xl font-semibold">
            Accessibility
          </h2>
          <p className="text-sm text-muted-foreground">
            The site can be used with a keyboard (skip link, visible focus, labelled controls) and
            respects your reduced-motion setting. The map has a text alternative: open the Lines
            panel for live status of every line. If something is not accessible to you, please tell
            us using the contact below.
          </p>
        </section>

        <section aria-labelledby="contact-us" className="space-y-2">
          <h2 id="contact-us" className="font-display text-xl font-semibold">
            Contact
          </h2>
          <p className="text-sm text-muted-foreground">
            Questions, corrections, copyright notices or privacy requests: open an issue at{" "}
            <a
              href="https://github.com/Qu34tin/TfL-Live/issues"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              github.com/Qu34tin/TfL-Live
            </a>
            .
          </p>
        </section>

        <section aria-labelledby="contact" className="space-y-2">
          <h2 id="contact" className="font-display text-xl font-semibold">
            Your rights
          </h2>
          <p className="text-sm text-muted-foreground">
            Because the site holds no personal data on a server, there is nothing to request or
            delete beyond the on-device data above, which you can remove with the button at the top
            or by clearing site data in your browser.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
