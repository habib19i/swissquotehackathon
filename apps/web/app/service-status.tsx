"use client";

import { useEffect, useState } from "react";

const SERVICES = [
  { name: "Swissquote co-signer", url: process.env.NEXT_PUBLIC_COSIGNER_URL ?? "http://localhost:4001" },
  { name: "Recovery provider", url: process.env.NEXT_PUBLIC_RECOVERY_URL ?? "http://localhost:4002" },
];

type State = "checking" | "online" | "offline";

/** Shows whether each separate service process is reachable. Both are mocks. */
export function ServiceStatus() {
  const [status, setStatus] = useState<Record<string, State>>({});

  useEffect(() => {
    for (const s of SERVICES) {
      setStatus((prev) => ({ ...prev, [s.name]: "checking" }));
      fetch(`${s.url}/health`)
        .then((r) => r.json())
        .then((body) => setStatus((prev) => ({ ...prev, [s.name]: body.offline ? "offline" : "online" })))
        .catch(() => setStatus((prev) => ({ ...prev, [s.name]: "offline" })));
    }
  }, []);

  return (
    <ul style={{ paddingLeft: 20, margin: 0 }}>
      {SERVICES.map((s) => (
        <li key={s.name}>
          {s.name}
          <span className="badge-mock">Mock</span>: {status[s.name] ?? "checking"}
        </li>
      ))}
    </ul>
  );
}
