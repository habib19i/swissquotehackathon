"use client";

import { useEffect, useState } from "react";
import type { PriceQuote } from "../app/api/price/route";

/** Live indicative price, refreshed every minute. */
export function usePrice(): PriceQuote | undefined {
  const [price, setPrice] = useState<PriceQuote>();
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/price")
        .then((r) => r.json())
        .then((p: PriceQuote) => alive && setPrice(p))
        .catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return price;
}
