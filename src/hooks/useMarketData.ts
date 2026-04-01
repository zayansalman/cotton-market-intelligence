"use client";

import { useState, useEffect } from "react";
import type { PricesResponse, Headline } from "@/lib/types";

export function useMarketData() {
  const [priceData, setPriceData] = useState<PricesResponse | null>(null);
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [priceRes, headlineRes] = await Promise.all([
          fetch("/api/prices"),
          fetch("/api/headlines"),
        ]);

        if (priceRes.ok) {
          setPriceData(await priceRes.json());
        } else {
          setError("Could not load cotton prices. Markets may be closed.");
        }

        if (headlineRes.ok) {
          setHeadlines(await headlineRes.json());
        }
      } catch {
        setError("Failed to connect to data services.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { priceData, headlines, loading, error, setError };
}
