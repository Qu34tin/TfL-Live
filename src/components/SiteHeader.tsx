import { Link } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function SiteHeader() {
  const link =
    "rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";
  const active = "bg-secondary text-foreground";
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "light") {
      document.documentElement.classList.remove("dark");
      setIsDark(false);
    } else if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
      setIsDark(true);
    }
  }, []);

  const toggleTheme = () => {
    const nextIsDark = !isDark;
    document.documentElement.classList.toggle("dark", nextIsDark);
    localStorage.setItem("theme", nextIsDark ? "dark" : "light");
    setIsDark(nextIsDark);
  };

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link
          to="/"
          className="flex items-center gap-2 font-display text-lg font-bold tracking-tight"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="pulse-dot absolute h-full w-full rounded-full bg-accent" />
          </span>
          TfL-<span className="text-primary">Live</span>
        </Link>
        <nav className="absolute left-1/2 flex -translate-x-1/2 gap-1">
          <Link
            to="/"
            className={link}
            activeProps={{ className: active }}
            activeOptions={{ exact: true }}
          >
            Status
          </Link>
          <Link to="/map" className={link} activeProps={{ className: active }}>
            Map
          </Link>
          <Link to="/boards" className={link} activeProps={{ className: active }}>
            Boards
          </Link>
        </nav>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
          title={`Switch to ${isDark ? "light" : "dark"} mode`}
          className="ml-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-3 px-5 py-6 text-sm text-muted-foreground">
        <p>Live data: Transport for London Open Data</p>
      </div>
    </footer>
  );
}
