"use client";

import { useEffect, useState } from "react";

/** "0:23 left", updated every second; "now" once the time has come. */
export function Countdown({ until, onDone }: { until: string; onDone?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.ceil((Date.parse(until) - now) / 1000));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (left === 0) onDone?.();
  }, [left, onDone]);

  if (left === 0) return <span className="tabular">now</span>;
  return (
    <span className="tabular">
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left
    </span>
  );
}

/** Production delays are hours; the demo shortens them and says so. */
export function DemoModeNote({ production }: { production: string }) {
  return (
    <span className="mock">
      Demo mode: {production} in real life
    </span>
  );
}
