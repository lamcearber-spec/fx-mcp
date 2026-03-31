/**
 * Macro economic data provider.
 * - ECB interest rates (Main Refinancing Rate)
 * - Crypto Fear & Greed Index
 * - Open Exchange Rates (166 currencies, free)
 */
import { TTLCache } from "../cache.js";

const cache = new TTLCache<any>();

// ECB Main Refinancing Rate
export async function getECBInterestRate(): Promise<{ rate: number; date: string }> {
  const cached = cache.get("ecb-rate");
  if (cached) return cached;

  const url = "https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.MRR_FR.LEV?format=csvdata&lastNObservations=1";
  const res = await fetch(url, { headers: { "User-Agent": "fx-mcp/0.1.0" } });
  if (!res.ok) throw new Error(`ECB rate API error: ${res.status}`);

  const csv = await res.text();
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",");
  const values = lines[lines.length - 1].split(",");
  const dateIdx = header.indexOf("TIME_PERIOD");
  const valueIdx = header.indexOf("OBS_VALUE");

  const result = {
    rate: parseFloat(values[valueIdx]),
    date: values[dateIdx],
  };

  cache.set("ecb-rate", result, 3600_000); // 1 hour
  return result;
}

// Crypto Fear & Greed Index
export async function getFearGreedIndex(): Promise<{
  value: number;
  classification: string;
  timestamp: string;
}> {
  const cached = cache.get("fng");
  if (cached) return cached;

  const res = await fetch("https://api.alternative.me/fng/?limit=1", {
    headers: { "User-Agent": "fx-mcp/0.1.0" },
  });
  if (!res.ok) throw new Error(`Fear & Greed API error: ${res.status}`);

  const data = await res.json() as any;
  const entry = data.data[0];
  const result = {
    value: parseInt(entry.value),
    classification: entry.value_classification,
    timestamp: new Date(parseInt(entry.timestamp) * 1000).toISOString(),
  };

  cache.set("fng", result, 300_000); // 5 min
  return result;
}

// Open Exchange Rates — 166 currencies (free, no auth)
export async function getAllFXRates(base = "EUR"): Promise<{
  base: string;
  date: string;
  rates: Record<string, number>;
}> {
  const cached = cache.get(`oer-${base}`);
  if (cached) return cached;

  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
    headers: { "User-Agent": "fx-mcp/0.1.0" },
  });
  if (!res.ok) throw new Error(`Open ER API error: ${res.status}`);

  const data = await res.json() as any;
  const result = {
    base: data.base_code,
    date: data.time_last_update_utc,
    rates: data.rates,
  };

  cache.set(`oer-${base}`, result, 300_000); // 5 min
  return result;
}

// Gas prices (Ethereum)
export async function getEthGasPrice(): Promise<{
  slow: number;
  standard: number;
  fast: number;
  source: string;
}> {
  const cached = cache.get("eth-gas");
  if (cached) return cached;

  // Use Etherscan free endpoint (no key needed for basic)
  const res = await fetch("https://api.etherscan.io/api?module=gastracker&action=gasoracle", {
    headers: { "User-Agent": "fx-mcp/0.1.0" },
  });

  if (!res.ok) throw new Error(`Etherscan API error: ${res.status}`);
  const data = await res.json() as any;

  if (data.status !== "1") {
    // Fallback: return estimate
    return { slow: 10, standard: 15, fast: 25, source: "estimate (API limit)" };
  }

  const result = {
    slow: parseFloat(data.result.SafeGasPrice),
    standard: parseFloat(data.result.ProposeGasPrice),
    fast: parseFloat(data.result.FastGasPrice),
    source: "Etherscan",
  };

  cache.set("eth-gas", result, 30_000); // 30s
  return result;
}
