import { TTLCache } from "../cache.js";

const cache = new TTLCache<{ rate: number; date: string }>();
const CACHE_TTL = 60_000; // 60 seconds

export async function getECBRate(
  from: string,
  to: string
): Promise<{ rate: number; date: string }> {
  const cacheKey = `ecb:${from}:${to}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // ECB quotes everything vs EUR. We need to handle three cases:
  // 1. from=EUR -> fetch to/EUR directly
  // 2. to=EUR -> fetch from/EUR and invert
  // 3. neither is EUR -> cross-rate via EUR

  if (from === to) {
    const result = { rate: 1, date: new Date().toISOString().slice(0, 10) };
    cache.set(cacheKey, result, CACHE_TTL);
    return result;
  }

  if (from === "EUR") {
    const result = await fetchECBDirect(to);
    cache.set(cacheKey, result, CACHE_TTL);
    return result;
  }

  if (to === "EUR") {
    const direct = await fetchECBDirect(from);
    const result = { rate: 1 / direct.rate, date: direct.date };
    cache.set(cacheKey, result, CACHE_TTL);
    return result;
  }

  // Cross-rate: from -> EUR -> to
  const fromEUR = await fetchECBDirect(from);
  const toEUR = await fetchECBDirect(to);
  const crossRate = toEUR.rate / fromEUR.rate;
  const result = { rate: crossRate, date: fromEUR.date };
  cache.set(cacheKey, result, CACHE_TTL);
  return result;
}

async function fetchECBDirect(
  currency: string
): Promise<{ rate: number; date: string }> {
  const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A?format=csvdata&lastNObservations=1`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ECB API error: ${res.status} ${res.statusText} for ${currency}`);
  }
  const csv = await res.text();
  return parseECBCSV(csv);
}

function parseECBCSV(csv: string): { rate: number; date: string } {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) {
    throw new Error("ECB returned empty CSV data");
  }
  const headers = lines[0].split(",");
  const values = lines[lines.length - 1].split(",");

  const dateIdx = headers.indexOf("TIME_PERIOD");
  const rateIdx = headers.indexOf("OBS_VALUE");

  if (dateIdx === -1 || rateIdx === -1) {
    throw new Error("ECB CSV missing expected columns (TIME_PERIOD, OBS_VALUE)");
  }

  const rate = parseFloat(values[rateIdx]);
  const date = values[dateIdx];

  if (isNaN(rate)) {
    throw new Error(`ECB returned non-numeric rate: ${values[rateIdx]}`);
  }

  return { rate, date };
}

export async function getECBHistory(
  from: string,
  to: string,
  days: number
): Promise<Array<{ date: string; rate: number }>> {
  if (from === to) {
    return [{ date: new Date().toISOString().slice(0, 10), rate: 1 }];
  }

  if (from === "EUR") {
    return await fetchECBHistory(to, days);
  }

  if (to === "EUR") {
    const history = await fetchECBHistory(from, days);
    return history.map((h) => ({ date: h.date, rate: 1 / h.rate }));
  }

  // Cross-rate history
  const fromHistory = await fetchECBHistory(from, days);
  const toHistory = await fetchECBHistory(to, days);

  const toMap = new Map(toHistory.map((h) => [h.date, h.rate]));
  const results: Array<{ date: string; rate: number }> = [];

  for (const fh of fromHistory) {
    const toRate = toMap.get(fh.date);
    if (toRate !== undefined) {
      results.push({ date: fh.date, rate: toRate / fh.rate });
    }
  }

  return results;
}

async function fetchECBHistory(
  currency: string,
  days: number
): Promise<Array<{ date: string; rate: number }>> {
  const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A?format=csvdata&lastNObservations=${days}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ECB API error: ${res.status} ${res.statusText}`);
  }
  const csv = await res.text();
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",");
  const dateIdx = headers.indexOf("TIME_PERIOD");
  const rateIdx = headers.indexOf("OBS_VALUE");

  if (dateIdx === -1 || rateIdx === -1) {
    throw new Error("ECB CSV missing expected columns");
  }

  const results: Array<{ date: string; rate: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    const rate = parseFloat(values[rateIdx]);
    if (!isNaN(rate)) {
      results.push({ date: values[dateIdx], rate });
    }
  }

  return results;
}
