const http = require("http");
const https = require("https");

const HTTP_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  "Accept": "application/json,text/plain,*/*"
};

function requestText(url, headers = HTTP_HEADERS, redirects = 0) {
  return new Promise((resolve, reject) => {
    const transport = String(url).startsWith("https:") ? https : http;
    const request = transport.get(url, { headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 5) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        requestText(nextUrl, headers, redirects + 1).then(resolve, reject);
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Fetch failed (${response.statusCode}) for ${url}`));
          return;
        }
        resolve(body);
      });
    });
    request.setTimeout(20000, () => request.destroy(new Error(`Fetch timed out for ${url}`)));
    request.on("error", reject);
  });
}

function pct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function ppt(value) {
  const num = Number(value || 0) * 100;
  return `${num >= 0 ? "+" : ""}${num.toFixed(1)}ppt`;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

async function fetchJson(url) {
  const text = await requestText(url, HTTP_HEADERS);
  if (text.trim().startsWith("<")) {
    throw new Error(`Expected JSON but received HTML for ${url}`);
  }
  return JSON.parse(text);
}

async function fetchText(url) {
  return requestText(url, { ...HTTP_HEADERS, "Accept": "text/html,text/plain,*/*" });
}

async function fetchOpenAiJson(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: prompt,
      temperature: 0.2
    })
  });
  if (!response.ok) return null;
  const data = await response.json();
  const text = data.output_text || data.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("\n") || "";
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    return null;
  }
}

function toIsoDateFromUnix(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function parseUsDate(value) {
  const parts = String(value || "").split("/");
  if (parts.length !== 3) return null;
  const [month, day, year] = parts.map((part) => Number(part));
  if (!month || !day || !year) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function moneyToNumber(value) {
  const cleaned = String(value || "").replace(/[$,%\s,]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function isoToUsDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const first = new Date(`${a}T00:00:00`).getTime();
  const second = new Date(`${b}T00:00:00`).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(second)) return Infinity;
  return Math.abs(first - second) / 86400000;
}

function chooseBetterEarningsRow(existing, next) {
  if (!existing) return next;
  if (existing.dateConfidence !== "reported" && next.dateConfidence === "reported") return next;
  if (existing.dateConfidence === "reported" && next.dateConfidence !== "reported") return existing;
  const existingHasEstimate = Number.isFinite(existing.estimatedEPS);
  const nextHasEstimate = Number.isFinite(next.estimatedEPS);
  if (!existingHasEstimate && nextHasEstimate) return next;
  if (!existing.transcriptUrl && next.transcriptUrl) return next;
  return existing;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function unwrapSearchUrl(url) {
  const raw = decodeHtml(url || "");
  try {
    const fullUrl = raw.startsWith("//") ? `https:${raw}` : raw;
    const parsed = new URL(fullUrl);
    const nested = parsed.searchParams.get("uddg") || parsed.searchParams.get("u");
    return nested ? decodeURIComponent(nested) : fullUrl;
  } catch (error) {
    return raw;
  }
}

function isLikelyTranscriptUrl(url, title = "") {
  const text = `${url} ${title}`.toLowerCase();
  if (!/transcript|earnings call|conference call|results call|quarterly call/.test(text)) return false;
  if (/youtube|spotify|podcasts|facebook|linkedin|twitter|x\.com|reddit/.test(text)) return false;
  return true;
}

function slugifyCompanyName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(inc|incorporated|corporation|corp|company|co|common stock|class a|class b|plc|ltd|limited)\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extractUsDateText(value) {
  const months = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
  const match = String(value || "").match(new RegExp(`\\b(${months})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`, "i"));
  if (!match) return null;
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = monthNames.findIndex((name) => match[1].toLowerCase().startsWith(name)) + 1;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
}

function sentenceSplit(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 45 && sentence.length <= 360);
}

function chooseBenchmark(symbol, exchange) {
  const upper = String(symbol || "").toUpperCase();
  const exch = String(exchange || "").toUpperCase();
  if (upper.endsWith(".NS") || exch.includes("NSE")) return "^NSEI";
  if (upper.endsWith(".BO") || exch.includes("BSE")) return "^BSESN";
  if (upper.endsWith(".HK")) return "^HSI";
  if (upper.endsWith(".KS") || upper.endsWith(".KQ") || exch.includes("KOREA")) return "^KS11";
  if (upper.endsWith(".T") || exch.includes("TOKYO")) return "^N225";
  if (upper.endsWith(".AX") || exch.includes("AUSTRALIA")) return "^AXJO";
  if (upper.endsWith(".PA") || exch.includes("PARIS")) return "^FCHI";
  if (upper.endsWith(".DE") || exch.includes("GERMANY")) return "^GDAXI";
  if (upper.endsWith(".L")) return "^FTSE";
  if (upper.endsWith(".TO") || exch.includes("TORONTO")) return "XIU.TO";
  return "SPY";
}

async function resolveTicker(query) {
  const raw = String(query || "").trim();
  const normalizedQuery = normalize(raw);
  const isQualifiedSymbol = /^[^^\s]+\.[a-z]{1,4}$/i.test(raw);
  if (raw.startsWith("^")) {
    return {
      symbol: raw.toUpperCase(),
      quoteType: "EQUITY",
      shortname: raw.toUpperCase(),
      longname: raw.toUpperCase(),
      exchDisp: "Yahoo"
    };
  }

  try {
    return await resolveTickerWithYahoo(raw, normalizedQuery);
  } catch (error) {
    try {
      return await resolveTickerWithNasdaq(raw);
    } catch (secondError) {
      if (isQualifiedSymbol) {
        return {
          symbol: raw.toUpperCase(),
          quoteType: "EQUITY",
          shortname: raw.toUpperCase(),
          longname: raw.toUpperCase(),
          exchDisp: "Yahoo"
        };
      }
      if (/^[a-z0-9-]{1,8}$/i.test(raw) && !raw.includes(" ")) {
        return {
          symbol: raw.toUpperCase(),
          quoteType: "EQUITY",
          shortname: raw.toUpperCase(),
          longname: raw.toUpperCase(),
          exchDisp: "Yahoo"
        };
      }
      throw secondError;
    }
  }
}

async function fetchYahooSearchQuotes(query) {
  const hosts = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];
  let lastError = null;
  for (const host of hosts) {
    try {
      const url = `https://${host}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=20&newsCount=0`;
      const data = await fetchJson(url);
      if (Array.isArray(data.quotes)) return data.quotes;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Yahoo search returned no results for ${query}.`);
}

async function resolveTickerWithYahoo(query, normalizedQuery = normalize(query)) {
  const quotes = await fetchYahooSearchQuotes(query);
  const candidates = quotes
    .filter((quote) => ["EQUITY", "ETF"].includes(quote.quoteType))
    .sort((a, b) => {
      const aExact = normalize(a.symbol) === normalizedQuery || normalize(a.shortname) === normalizedQuery || normalize(a.longname) === normalizedQuery;
      const bExact = normalize(b.symbol) === normalizedQuery || normalize(b.shortname) === normalizedQuery || normalize(b.longname) === normalizedQuery;
      if (aExact !== bExact) return aExact ? -1 : 1;
      return Number(b.score || 0) - Number(a.score || 0);
    });
  if (!candidates.length) {
    throw new Error(`Could not resolve "${query}" to a listed equity or ETF.`);
  }
  return candidates[0];
}

async function resolveTickerWithNasdaq(query) {
  const url = `https://api.nasdaq.com/api/autocomplete/slookup/10?search=${encodeURIComponent(query)}`;
  const data = await fetchJson(url);
  const rows = Array.isArray(data.data) ? data.data : [];
  const candidate = rows.find((row) => ["STOCKS", "ETF"].includes(row.asset)) || rows[0];
  if (!candidate?.symbol) {
    throw new Error(`Could not resolve "${query}" to a listed equity or ETF.`);
  }
  return {
    symbol: candidate.symbol,
    quoteType: candidate.asset === "ETF" ? "ETF" : "EQUITY",
    shortname: candidate.name,
    longname: candidate.name,
    exchDisp: candidate.exchange || "Nasdaq"
  };
}

async function fetchYahooPrices(symbol, range = "5y") {
  const hosts = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];
  let data = null;
  let lastError = null;
  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=1d&events=div%2Csplits`;
      data = await fetchJson(url);
      if (data?.chart?.result?.[0]?.timestamp?.length) break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!data) throw lastError || new Error(`No Yahoo price response returned for ${symbol}.`);
  const result = data.chart?.result?.[0];
  if (!result?.timestamp?.length) {
    throw new Error(`No Yahoo price history returned for ${symbol}.`);
  }
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  return result.timestamp.map((timestamp, index) => {
    const close = Number(adjusted[index] ?? quote.close?.[index]);
    return {
      date: toIsoDateFromUnix(timestamp),
      close,
      volume: Number(quote.volume?.[index] || 0)
    };
  }).filter((row) => row.date && Number.isFinite(row.close));
}

async function fetchNasdaqHistoricalPrices(symbol, startDate) {
  if (!/^[A-Z.-]{1,8}$/i.test(symbol) || symbol.includes(".")) {
    throw new Error(`Nasdaq historical fallback does not support ${symbol}.`);
  }
  const end = new Date();
  const start = startDate ? new Date(`${startDate}T00:00:00`) : new Date(end);
  if (!startDate) start.setUTCFullYear(start.getUTCFullYear() - 5);
  const assetClass = ["SPY", "QQQ", "DIA", "IWM"].includes(String(symbol).toUpperCase()) ? "etf" : "stocks";
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol.toUpperCase())}/historical?assetclass=${assetClass}&fromdate=${isoToUsDate(start.toISOString().slice(0, 10))}&todate=${isoToUsDate(end.toISOString().slice(0, 10))}&limit=9999`;
  const data = await fetchJson(url);
  const rows = data.data?.tradesTable?.rows || [];
  return rows.map((row) => {
    const date = parseUsDate(row.date);
    const close = moneyToNumber(row.close);
    return {
      date,
      close,
      volume: moneyToNumber(row.volume) || 0
    };
  }).filter((row) => row.date && Number.isFinite(row.close))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function fetchPriceHistory(symbol, range = "5y", startDate = null) {
  let yahooError = null;
  try {
    return await fetchYahooPrices(symbol, startDate ? "max" : range);
  } catch (error) {
    yahooError = error;
    if (startDate) {
      try {
        return await fetchYahooPrices(symbol, range);
      } catch (secondError) {
        yahooError = secondError;
      }
    }
  }
  try {
    return await fetchNasdaqHistoricalPrices(symbol, startDate);
  } catch (fallbackError) {
    throw yahooError || fallbackError;
  }
}

async function fetchNasdaqEarnings(symbol) {
  const cleanSymbol = String(symbol || "").split(".")[0].toLowerCase();
  const url = `https://api.nasdaq.com/api/company/${encodeURIComponent(cleanSymbol)}/earnings-surprise`;
  const data = await fetchJson(url);
  const rows = data.data?.earningsSurpriseTable?.rows || [];
  return rows.map((row) => ({
    fiscalQuarterEnd: row.fiscalQtrEnd,
    reportedDate: parseUsDate(row.dateReported),
    reportedEPS: Number(row.eps),
    estimatedEPS: Number(row.consensusForecast),
    surprisePercentage: Number(row.percentageSurprise)
  })).filter((row) => row.reportedDate);
}

function marketBeatExchangePath(exchange) {
  const exch = String(exchange || "").toUpperCase();
  if (exch.includes("NASDAQ")) return "NASDAQ";
  if (exch.includes("NYSE")) return "NYSE";
  if (exch.includes("AMEX")) return "NYSEAMERICAN";
  return "NASDAQ";
}

async function fetchMarketBeatEarnings(symbol, exchange) {
  if (!/^[A-Z]{1,8}$/i.test(symbol)) return [];
  const exchangePath = marketBeatExchangePath(exchange);
  const url = `https://www.marketbeat.com/stocks/${exchangePath}/${symbol.toUpperCase()}/earnings/?startdate=2000-01-01`;
  const html = await fetchText(url);
  const tableMatch = html.match(/<table[^>]*id="earnings-history"[\s\S]*?<\/table>/i);
  if (!tableMatch) return [];
  const rows = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  return rows.map((row) => {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 5) return null;
    const dateText = stripHtml(cells[0]);
    if (/estimated/i.test(dateText)) return null;
    const dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!dateMatch) return null;
    const reportedDate = parseUsDate(dateMatch[0]);
    const detailMatch = row.match(/data-clean="([^"]+)"/i) || row.match(/href="([^"]*\/earnings\/reports\/[^"]+)"/i);
    return {
      source: "MarketBeat earnings history",
      fiscalQuarterEnd: stripHtml(cells[1]) || reportedDate,
      reportedDate,
      reportedEPS: moneyToNumber(stripHtml(cells[3])),
      estimatedEPS: moneyToNumber(stripHtml(cells[2])),
      surprise: moneyToNumber(stripHtml(cells[4])),
      transcriptUrl: detailMatch ? new URL(detailMatch[1], "https://www.marketbeat.com").toString() : null,
      dateConfidence: "reported"
    };
  }).filter(Boolean);
}

async function fetchMacrotrendsQuarterlyEps(symbol, companyName) {
  if (!/^[A-Z]{1,8}$/i.test(symbol)) return [];
  const slug = slugifyCompanyName(companyName) || symbol.toLowerCase();
  const url = `https://www.macrotrends.net/stocks/charts/${symbol.toUpperCase()}/${slug}/eps-earnings-per-share-diluted`;
  const html = await fetchText(url);
  const quarterlySection = html.match(/<th[^>]*>\s*[\s\S]*?Quarterly EPS[\s\S]*?<\/table>/i)?.[0] || "";
  const rows = [...quarterlySection.matchAll(/<tr[\s\S]*?<td>(\d{4}-\d{2}-\d{2})<\/td>[\s\S]*?<td>\$?(-?\d+(?:\.\d+)?)<\/td>[\s\S]*?<\/tr>/gi)];
  return rows.map((match) => ({
    source: "Macrotrends quarterly EPS history",
    fiscalQuarterEnd: match[1],
    reportedDate: addDays(match[1], 30),
    reportedEPS: Number(match[2]),
    estimatedEPS: null,
    surprisePercentage: null,
    transcriptUrl: null,
    dateConfidence: "fiscal-period-proxy"
  }));
}

async function fetchYahooQuarterlyEps(symbol) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - (10 * 365 * 86400);
  const types = "quarterlyDilutedEPS,quarterlyBasicEPS";
  const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${types}&period1=${start}&period2=${end}`;
  const data = await fetchJson(url);
  const series = Array.isArray(data.timeseries?.result) ? data.timeseries.result : [];
  const preferred = series.find((item) => Array.isArray(item.quarterlyDilutedEPS)) ||
    series.find((item) => Array.isArray(item.quarterlyBasicEPS));
  const rows = preferred?.quarterlyDilutedEPS || preferred?.quarterlyBasicEPS || [];
  return rows.map((row) => ({
    source: "Yahoo Finance global quarterly fundamentals",
    fiscalQuarterEnd: row.asOfDate,
    reportedDate: addDays(row.asOfDate, 30),
    reportedEPS: Number(row.reportedValue?.raw),
    estimatedEPS: null,
    surprisePercentage: null,
    transcriptUrl: null,
    dateConfidence: "fiscal-period-proxy"
  })).filter((row) => row.fiscalQuarterEnd && Number.isFinite(row.reportedEPS));
}

async function fetchLiveEarningsHistory(symbol, quote) {
  const [marketBeat, nasdaq, macrotrends, yahooGlobal] = await Promise.all([
    fetchMarketBeatEarnings(symbol, quote.exchDisp || quote.exchange).catch(() => []),
    fetchNasdaqEarnings(symbol).catch(() => []),
    fetchMacrotrendsQuarterlyEps(symbol, quote.longname || quote.shortname || symbol).catch(() => []),
    fetchYahooQuarterlyEps(symbol).catch(() => [])
  ]);
  const merged = new Map();
  [...yahooGlobal, ...macrotrends, ...nasdaq.map((row) => ({ ...row, source: "Nasdaq earnings surprise", dateConfidence: "reported" })), ...marketBeat]
    .forEach((row) => {
      const key = row.fiscalQuarterEnd || row.reportedDate;
      if (!key || !row.reportedDate) return;
      const existing = merged.get(key);
      if (!existing || existing.dateConfidence !== "reported" || row.dateConfidence === "reported") {
        merged.set(key, row);
      }
    });
  return [...merged.values()]
    .filter((row) => row.reportedDate <= new Date().toISOString().slice(0, 10))
    .sort((a, b) => new Date(a.reportedDate) - new Date(b.reportedDate))
    .reduce((deduped, row) => {
      const existingIndex = deduped.findIndex((existing) => daysBetween(existing.reportedDate, row.reportedDate) <= 8);
      if (existingIndex < 0) {
        deduped.push(row);
      } else {
        deduped[existingIndex] = chooseBetterEarningsRow(deduped[existingIndex], row);
      }
      return deduped;
    }, [])
    .sort((a, b) => new Date(a.reportedDate) - new Date(b.reportedDate));
}

function issuerCoreName(value) {
  return normalize(value)
    .replace(/\b(american depositary shares?|american depositary receipts?|depositary shares?|depositary receipts?|ads|adr|ordinary shares?|common stock|class [a-z]|incorporated|corporation|corp|company|co|plc|limited|ltd)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameIssuer(left, right) {
  const a = issuerCoreName(left);
  const b = issuerCoreName(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

async function discoverIssuerListings(quote) {
  const companyName = quote.longname || quote.shortname || quote.symbol;
  const quotes = await fetchYahooSearchQuotes(issuerCoreName(companyName) || companyName);
  return quotes
    .filter((candidate) => candidate.quoteType === "EQUITY" && candidate.symbol && candidate.symbol !== quote.symbol)
    .filter((candidate) => sameIssuer(companyName, candidate.longname || candidate.shortname || candidate.symbol))
    .sort((a, b) => {
      const aPrimary = /\.(KS|KQ|HK|T|L|PA|DE|AX|NS|BO|TO)$/i.test(a.symbol) ? 1 : 0;
      const bPrimary = /\.(KS|KQ|HK|T|L|PA|DE|AX|NS|BO|TO)$/i.test(b.symbol) ? 1 : 0;
      if (aPrimary !== bPrimary) return bPrimary - aPrimary;
      const aNew = a.newListingDate ? 1 : 0;
      const bNew = b.newListingDate ? 1 : 0;
      if (aNew !== bNew) return aNew - bNew;
      return Number(b.score || 0) - Number(a.score || 0);
    })
    .slice(0, 5);
}

async function loadListingCoverage(quote) {
  const [earnings, prices] = await Promise.all([
    fetchLiveEarningsHistory(quote.symbol, quote).catch(() => []),
    fetchPriceHistory(quote.symbol, "5y").catch(() => [])
  ]);
  return { quote, earnings, prices };
}

async function selectResearchListing(requestedQuote) {
  const requested = await loadListingCoverage(requestedQuote);
  if (requested.earnings.length >= 2 && requested.prices.length >= 60) return requested;

  const alternatives = await discoverIssuerListings(requestedQuote).catch(() => []);
  const coverage = await Promise.all(alternatives.map((quote) => loadListingCoverage(quote)));
  return [requested, ...coverage].sort((a, b) => {
    const aScore = Math.min(a.earnings.length, 8) * 1000 + Math.min(a.prices.length, 1000);
    const bScore = Math.min(b.earnings.length, 8) * 1000 + Math.min(b.prices.length, 1000);
    return bScore - aScore;
  })[0];
}

async function fetchStockAnalysisTranscriptIndex(symbol) {
  if (!/^[A-Z]{1,8}$/i.test(symbol)) return [];
  const baseUrl = `https://stockanalysis.com/stocks/${symbol.toLowerCase()}/transcripts/`;
  const html = await fetchText(baseUrl);
  const seen = new Set();
  return [...html.matchAll(/href="(\/stocks\/[^"]+\/transcripts\/[^"]+\/)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const url = new URL(match[1], "https://stockanalysis.com").toString();
      if (seen.has(url)) return null;
      seen.add(url);
      const title = stripHtml(decodeHtml(match[2]));
      if (!/earnings|q[1-4]|quarter/i.test(`${title} ${url}`)) return null;
      return { url, title };
    })
    .filter(Boolean)
    .slice(0, 16);
}

async function fetchStockAnalysisTranscript(entry) {
  const html = await fetchText(entry.url);
  const pageText = stripHtml(html);
  const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || entry.title);
  const callHeading = pageText.match(/Earnings Call:\s+.{0,120}?(?:Full Transcript|Full Summary|Slides|Quarterly report|Play Audio)/i)?.[0] || "";
  const date = extractUsDateText(callHeading) || extractUsDateText(title) || extractUsDateText(pageText);
  const summaryMatch = pageText.match(/\bSummary\s+([\s\S]*?)(?:\s+[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+,|\s+Operator\b|\s+Question-and-Answer|\s+Questions and Answers|$)/);
  const transcriptSentences = [...html.matchAll(/<span[^>]*class="[^"]*transcript-sentence[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => stripHtml(decodeHtml(match[1])))
    .filter(Boolean);
  const transcriptStart = pageText.search(/\b(Operator|Good afternoon|Good morning|Good day|Welcome to)\b/i);
  const fallbackText = transcriptStart >= 0 ? pageText.slice(transcriptStart) : pageText;
  return {
    ...entry,
    title,
    date,
    summary: summaryMatch ? summaryMatch[1].slice(0, 1200).trim() : "",
    text: (transcriptSentences.length ? transcriptSentences.join(" ") : fallbackText).slice(0, 90000)
  };
}

async function searchTranscriptPages(query, limit = 10) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  const seen = new Set();
  return [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const pageUrl = unwrapSearchUrl(match[1]);
      const title = stripHtml(decodeHtml(match[2]));
      if (seen.has(pageUrl) || !isLikelyTranscriptUrl(pageUrl, title)) return null;
      seen.add(pageUrl);
      return { url: pageUrl, title, source: "web-search" };
    })
    .filter(Boolean)
    .slice(0, limit);
}

async function fetchGenericTranscript(entry) {
  const html = await fetchText(entry.url);
  const pageText = stripHtml(html);
  const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || entry.title);
  if (!/transcript|earnings call|conference call|results call|quarterly call/i.test(`${title} ${pageText.slice(0, 2000)}`)) {
    return null;
  }
  const transcriptSentences = [...html.matchAll(/<span[^>]*class="[^"]*transcript-sentence[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => stripHtml(decodeHtml(match[1])))
    .filter(Boolean);
  const date = extractUsDateText(title) || extractUsDateText(pageText);
  const transcriptStart = pageText.search(/\b(Operator|Good afternoon|Good morning|Good day|Welcome to|Prepared Remarks|Question-and-Answer|Questions and Answers)\b/i);
  const fallbackText = transcriptStart >= 0 ? pageText.slice(transcriptStart) : pageText;
  const text = (transcriptSentences.length ? transcriptSentences.join(" ") : fallbackText).slice(0, 90000);
  if (text.length < 3000) return null;
  return {
    ...entry,
    title,
    date,
    summary: "",
    text
  };
}

async function fetchTranscriptCandidates(symbol, quote, events = []) {
  const stockAnalysisIndex = await fetchStockAnalysisTranscriptIndex(symbol).catch(() => []);
  const companyName = quote?.longname || quote?.shortname || symbol;
  const latestYears = [...new Set(events.map((event) => String(event.reportedDate || "").slice(0, 4)).filter(Boolean))].slice(-3);
  const searchQueries = [
    `${companyName} ${symbol} earnings call transcript`,
    `${companyName} ${latestYears.at(-1) || ""} earnings call transcript`
  ];
  const searchResults = (await Promise.all(searchQueries.map((query) => searchTranscriptPages(query, 8).catch(() => []))))
    .flat();
  const merged = new Map();
  [...stockAnalysisIndex, ...searchResults].forEach((entry) => {
    if (entry?.url && !merged.has(entry.url)) merged.set(entry.url, entry);
  });
  const entries = [...merged.values()].slice(0, 18);
  const pages = await Promise.all(entries.map((entry) => {
    const isStockAnalysis = /stockanalysis\.com\/stocks\/[^/]+\/transcripts\//i.test(entry.url);
    return (isStockAnalysis ? fetchStockAnalysisTranscript(entry) : fetchGenericTranscript(entry)).catch(() => null);
  }));
  return pages.filter((page) => page?.text && page.text.length > 3000);
}

function matchTranscriptForEvent(transcripts, event) {
  if (!event?.reportedDate || !transcripts.length) return null;
  const candidates = transcripts
    .filter((transcript) => transcript.date)
    .map((transcript) => ({
      transcript,
      distance: daysBetween(transcript.date, event.reportedDate)
    }))
    .filter((item) => item.distance <= 14)
    .sort((a, b) => a.distance - b.distance);
  return candidates[0]?.transcript || null;
}

function scoreTranscriptSentence(sentence, abnormal5d) {
  const text = sentence.toLowerCase();
  const themeWeights = [
    ["guidance", 5], ["outlook", 5], ["expect", 4], ["forecast", 4], ["target", 3],
    ["margin", 5], ["profit", 4], ["loss", 4], ["cost", 4], ["cash flow", 5],
    ["growth", 5], ["revenue", 4], ["demand", 5], ["orders", 3], ["deliveries", 4],
    ["capex", 5], ["investment", 4], ["competition", 4], ["competitive", 4],
    ["tariff", 4], ["interest rate", 4], ["pricing", 4], ["inventory", 3],
    ["production", 4], ["capacity", 3], ["ai", 3], ["robotaxi", 3], ["energy", 3],
    ["regulatory", 3], ["supply", 3], ["backlog", 3], ["breakeven", 5]
  ];
  const positiveWords = ["strong", "improved", "accelerat", "record", "higher", "expand", "profitable", "confidence", "backlog"];
  const negativeWords = ["declin", "lower", "pressure", "uncertain", "risk", "cost", "loss", "delay", "competition", "tariff", "negative"];
  let score = 0;
  if (/\b(due to|because|as a result|result of|driven by|impacted by|pressure from|compression from|declined due to|improved due to|increased because)\b/i.test(sentence)) score += 8;
  if (/\b(we expect|we are expecting|we forecast|we plan|we will|we announced|we launched|we achieved|we delivered|we saw|we set new records)\b/i.test(sentence)) score += 6;
  if (/\b(record|declined|improved|increased|decreased|compression|higher|lower|negative free cash flow|tariffs?|competition|demand constrained|margin|capex)\b/i.test(sentence)) score += 4;
  if (sentence.trim().endsWith("?")) score -= 5;
  themeWeights.forEach(([keyword, weight]) => {
    if (text.includes(keyword)) score += weight;
  });
  const directionWords = abnormal5d >= 0 ? positiveWords : negativeWords;
  directionWords.forEach((word) => {
    if (text.includes(word)) score += 2;
  });
  if (/\b(question|analyst|q&a|asked)\b/i.test(sentence)) score += 1;
  if (/\b(forward-looking|safe harbor|sec|non-gaap|website|please use the raise hand|full transcript|download transcript)\b/i.test(sentence)) score -= 12;
  return score;
}

function cleanCatalystSentence(sentence) {
  return String(sentence || "")
    .replace(/\s+/g, " ")
    .replace(/^(and|but|so)\s+/i, "")
    .trim();
}

function shortenCatalyst(sentence, maxLength = 120) {
  const cleaned = cleanCatalystSentence(sentence);
  if (cleaned.length <= maxLength) return cleaned;
  const preferredBreak = cleaned.slice(0, maxLength).replace(/[,;:]\s+[^,;:]*$/, "");
  const fallbackBreak = cleaned.slice(0, maxLength).replace(/\s+\S*$/, "");
  return `${(preferredBreak.length > 50 ? preferredBreak : fallbackBreak).trim()}...`;
}

function finishChartLabel(value, maxLength = 72) {
  let text = cleanCatalystSentence(value)
    .replace(/(\d+(?:\.\d+)?%)\s+and\s+(\d+(?:\.\d+)?%)/i, "$1-$2")
    .replace(/\bin the high teens\b/i, "high-teens")
    .replace(/\bthe low single digits\b/i, "low-single-digit")
    .replace(/[.]+$/, "");
  if (text.length > maxLength) {
    text = text.slice(0, maxLength).replace(/\s+\S*$/, "").replace(/[,;:]$/, "");
  }
  text = text.replace(/\s+\b(?:and|or|with|in|on|at|from|to)\b$/i, "");
  text = text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
  text = text.replace(/^ICloud\b/, "iCloud").replace(/^IPhone\b/, "iPhone");
  return `${text}.`;
}

function chartDriverLabel(catalyst, evidenceSentence = "") {
  const source = cleanCatalystSentence(evidenceSentence || catalyst);
  let context = "";
  let body = source;
  const contextMatch = source.match(/^In (?:(?:our|the company's)\s+)?([^,]{2,48}),\s*(.+)$/i);
  if (contextMatch) {
    context = contextMatch[1]
      .replace(/\bbusiness\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    body = contextMatch[2];
  }

  const money = source.match(/[$€£₹]\s?\d+(?:\.\d+)?\s*(?:million|billion)?/i)?.[0];
  if (/tariff/i.test(source) && money) {
    if (/tariff[^.]{0,45}(?:increased|rose)|(?:increased|rose)[^.]{0,45}tariff/i.test(source)) {
      return finishChartLabel(`Tariff costs rose by ${money}`);
    }
    if (/gross margin|margin guidance/i.test(source)) {
      return finishChartLabel(`Gross-margin guidance included ${money} of tariff costs`);
    }
    return finishChartLabel(`${money} tariff-cost impact was disclosed`);
  }

  const offsetSummary = String(catalyst || "").match(/^(.+?) partially offset the improvement in (.+)$/i);
  if (offsetSummary) {
    if (/efficiency gains/i.test(source) && /investments? in AI/i.test(source)) {
      return finishChartLabel("AI investment offset cloud-margin efficiency gains");
    }
    return finishChartLabel(`${offsetSummary[1].split(",")[0]} offset ${offsetSummary[2]} gains`);
  }

  if (/cloud services[^.]{0,100}(?:all-time )?revenue record[^.]{0,100}iCloud paying accounts/i.test(source)) {
    return finishChartLabel("iCloud account growth drove record cloud-services revenue");
  }
  if (/supply constraints? driven by higher-than-expected (?:levels of )?demand/i.test(source)) {
    const product = source.match(/^([A-Z][A-Za-z0-9& -]{1,24}) revenue/i)?.[1] || "Product";
    return finishChartLabel(`Higher-than-expected demand constrained ${product} supply`);
  }
  if (/Greater China[^.]{0,40}grew\s+([\d.]+%)[^.]{0,100}driven by iPhone/i.test(source)) {
    const growth = source.match(/grew\s+([\d.]+%)/i)?.[1] || "strongly";
    return finishChartLabel(`iPhone drove ${growth} growth in Greater China`);
  }
  const iphoneRecord = source.match(/iPhone set a revenue record[^.]{0,55}at\s+([$€£₹]\s?\d+(?:\.\d+)?\s*(?:million|billion)?)/i);
  if (iphoneRecord) return finishChartLabel(`iPhone revenue hit a ${iphoneRecord[1]} quarterly record`);

  const marginDecline = source.match(/gross margin percentage[^.]{0,90}(?:down|decreased)\s+(\d+(?:\.\d+)?(?:%| points?| basis points?)?(?: year over year)?)/i);
  if (marginDecline) return finishChartLabel(`Gross margin fell ${marginDecline[1]}`);

  const marginResult = source.match(/(?:company )?gross margin was\s+(\d+(?:\.\d+)?%)[^.]{0,90}?(?:up|down)\s+(\d+(?:\.\d+)?\s+basis points?)/i);
  if (marginResult) {
    const direction = new RegExp(`gross margin was\\s+${marginResult[1]}[^.]{0,90}?down`, "i").test(source) ? "down" : "up";
    return finishChartLabel(`Gross margin reached ${marginResult[1]}, ${direction} ${marginResult[2]}`);
  }

  const marginPressure = source.match(/margin compression (?:from|due to)\s+([^.;]+)/i);
  if (marginPressure) return finishChartLabel(`Margin pressure came from ${marginPressure[1]}`);

  const guidance = body.match(/(?:we|management)\s+expect\w*\s+(.+?)\s+to be\s+(.+?)(?:,|\.| driven by|$)/i);
  if (guidance) {
    const metric = `${context ? `${context} ` : ""}${guidance[1]}`
      .replace(/\bbetween\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const value = guidance[2].replace(/^between\s+/i, "").replace(/\s+in constant currency/i, "").trim();
    return finishChartLabel(`${metric} guidance was ${value}`);
  }

  const directGrowthGuidance = body.match(/(?:we|management)\s+expect\w*\s+(.+?growth)\s+of\s+(.+?)(?:,|\.| driven by|$)/i);
  if (directGrowthGuidance) {
    const metric = `${context ? `${context} ` : ""}${directGrowthGuidance[1]}`.replace(/\s+/g, " ").trim();
    const value = directGrowthGuidance[2].replace(/\s+in constant currency/i, "").trim();
    return finishChartLabel(`${metric} guidance was ${value}`);
  }

  const expectedDecline = body.match(/(?:we|management)\s+expect\w*\s+(.+?)\s+to decline\s+(?:in\s+)?(.+?)(?:,|\.|\s+as\s+|$)/i);
  if (expectedDecline) {
    const metric = `${context ? `${context} ` : ""}${expectedDecline[1]}`.replace(/\s+/g, " ").trim();
    return finishChartLabel(`${metric} outlook: ${expectedDecline[2]} decline`);
  }

  const outlookDecline = body.match(/^(.+?)\s+(?:should|will|is expected to)\s+decline\s+([^,.;]+)/i);
  if (outlookDecline) {
    return finishChartLabel(`${outlookDecline[1]} outlook: ${outlookDecline[2]} decline`);
  }

  const missedMovement = body.match(/^(.+?)\s+(decreased|declined)\s+(.+?)\s+and was\s+below expectations/i);
  if (missedMovement) {
    const subject = `${context ? `${context} ` : ""}${missedMovement[1]}`.replace(/\s+/g, " ").trim();
    return finishChartLabel(`${subject} fell ${missedMovement[3]} and missed expectations`);
  }

  const missed = body.match(/^(.+?)\s+(decreased|declined|was)\s+(.+?)(?:,\s*[^,]{0,30})?\s+below expectations/i);
  if (missed) {
    const subject = `${context ? `${context} ` : ""}${missed[1]}`.replace(/\s+/g, " ").trim();
    const movement = /decreased|declined/i.test(missed[2]) ? `fell ${missed[3]}` : "missed expectations";
    return finishChartLabel(`${subject} ${movement}${movement.includes("missed") ? "" : " and missed expectations"}`);
  }

  const beat = body.match(/^(.+?)\s+(?:grew|increased)\s+([^,]+)[^.]{0,100}\b(?:ahead of|above) (?:our )?expectations/i);
  if (beat) {
    const subject = `${context ? `${context} ` : ""}${beat[1]}`.replace(/\s+/g, " ").trim();
    return finishChartLabel(`${subject} grew ${beat[2]} and beat expectations`);
  }

  const causalResult = body.match(/^(.+?\b(?:increased|improved|decreased|declined)\b[^,]{0,42}),?\s+(?:primarily )?(?:driven by|due to|as a result of)\s+([^,.;]+)/i);
  if (causalResult) {
    return finishChartLabel(`${causalResult[1]} on ${causalResult[2]}`);
  }

  const firstClause = String(catalyst || source).split(/[,;]|\bwhich\b/i)[0]
    .replace(/^Management (?:reported|guided|said)\s+/i, "")
    .trim();
  return finishChartLabel(firstClause || "Earnings-call event changed expectations");
}

const EVENT_TOPICS = [
  { key: "tariff", pattern: /tariff|trade restriction|customs dut/i },
  { key: "guidance", pattern: /guidance|outlook|forecast|we expect|we are expecting|target|breakeven/i },
  { key: "margin", pattern: /gross margin|operating margin|contribution margin|profitability|ebitda|free cash flow|cash flow/i },
  { key: "demand", pattern: /demand|orders|deliveries|volume|backlog|customers|users|subscribers|paying accounts|aov|gov/i },
  { key: "investment", pattern: /capex|capital expenditure|investment|spend|capacity|production|factory|ramp|store expansion|cash burn/i },
  { key: "competition", pattern: /competition|competitive|pricing|promotion|subsid|market share/i },
  { key: "product", pattern: /launch|new product|new model|platform|roadmap|robotaxi|software|technology|\bai\b/i },
  { key: "supply", pattern: /supply constraint|shortage|inventory|capacity constraint|production constraint/i },
  { key: "cost", pattern: /cost|opex|operating expense|r&d|restructur|headcount/i },
  { key: "growth", pattern: /revenue|sales|growth|grew|declin|accelerat|record/i }
];

function sentenceTopics(sentence) {
  return EVENT_TOPICS.filter((topic) => topic.pattern.test(sentence)).map((topic) => topic.key);
}

function eventPolarity(sentence) {
  const text = String(sentence || "").toLowerCase();
  let positive = (text.match(/\b(record|strong|accelerat\w*|improv\w*|higher|grew|growth|expand\w*|favorable|above|beat|profitable|confidence)\b/g) || []).length;
  let negative = (text.match(/\b(declin\w*|lower|pressure|uncertain\w*|risk|loss|delay\w*|constraint\w*|shortage|headwind|unfavorable|below|miss|tariff|cash burn)\b/g) || []).length;
  if (/\b(ahead of|above|better than|exceeded) expectations?\b/i.test(text)) positive += 4;
  if (/\b(below|behind|short of|worse than|slower than|slower-than) expectations?\b/i.test(text)) negative += 4;
  if (/\b(cut|lowered|reduced|delayed|wind down|stop production)\b/i.test(text)) negative += 3;
  if (/\b(raised|increased) (?:the )?(?:guidance|outlook|forecast|target)\b/i.test(text)) positive += 3;
  return positive - negative;
}

function eventSpecificity(sentence) {
  const text = String(sentence || "");
  let score = 0;
  if (/[$€£₹]\s?\d|\b\d+(?:\.\d+)?%|basis points?|\b\d+(?:\.\d+)?\s*(?:million|billion)\b/i.test(text)) score += 8;
  if (/\b(due to|because|driven by|impacted by|pressure from|offset by|includes?|reflects?)\b/i.test(text)) score += 7;
  if (/\b(raised|lowered|cut|increased|decreased|accelerated|slowed|record|constraint|announced|launched|transition|restructur)\w*\b/i.test(text)) score += 6;
  if (/\b(guidance|outlook|forecast|target|we expect|we are expecting)\b/i.test(text)) score += 4;
  if (sentenceTopics(text).length > 1) score += 3;
  if (text.length >= 55 && text.length <= 360) score += 2;
  if (/\?$/.test(text.trim()) || /\b(?:could you|can you|wondering if|my question)\b/i.test(text)) score -= 15;
  if (/\b(forward-looking|safe harbor|non-gaap|website|operator instructions)\b/i.test(text)) score -= 20;
  return score;
}

function rewriteEventSentence(sentence, abnormal5d = 0) {
  let text = cleanCatalystSentence(sentence)
    .replace(/^(?:now |and |but |so )+/i, "")
    .replace(/^let's take a closer look at [^.]+\.\s*/i, "")
    .replace(/^on the ([^,]+) front,\s*/i, "$1: ")
    .replace(/^we expect\s+/i, "Management guided ")
    .replace(/^we are expecting\s+/i, "Management guided for ")
    .replace(/^we (?:plan|intend) to\s+/i, "Management plans to ")
    .replace(/^we announced\s+/i, "Management announced ")
    .replace(/^we launched\s+/i, "Management launched ")
    .replace(/^we achieved\s+/i, "Management achieved ")
    .replace(/^we delivered\s+/i, "Management delivered ")
    .replace(/^we saw\s+/i, "Management reported ")
    .replace(/\bwe\b/gi, "management")
    .replace(/\bour\b/gi, "the company's")
    .replace(/\bI think\b/gi, "management said")
    .replace(/\byou know\b,?\s*/gi, "")
    .replace(/\bright\b,?\s*/gi, "")
    .replace(/\bmanagement (?:still )?expect\b/gi, (match) => match.replace(/expect$/i, "expects"))
    .replace(/\bmanagement have\b/gi, "management has");

  if (abnormal5d < 0) {
    const offset = text.match(/\b(?:partially|partly) offset by\s+([^.;]{5,130})/i);
    const metric = text.match(/^(.{3,80}?)(?:\s+increased|\s+improved|\s+was higher)/i);
    if (offset && metric) {
      text = `${offset[1]} partially offset the improvement in ${metric[1]}`;
    }
  }

  const guidance = text.match(/^Management guided (.+?) to be (.+?)(?:,|\.|$)/i);
  if (guidance) text = `${guidance[1]} guidance was set at ${guidance[2]}${text.slice(guidance[0].length - 1)}`;
  text = text.replace(/\s+,/g, ",").trim();
  text = text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
  return shortenCatalyst(text, 176);
}

function buildEventCandidates(sentences, abnormal5d) {
  return sentences
    .map((sentence) => {
      const topics = sentenceTopics(sentence);
      const polarity = eventPolarity(sentence);
      const directionFit = abnormal5d >= 0 ? polarity : -polarity;
      const baseScore = scoreTranscriptSentence(sentence, abnormal5d);
      return {
        sentence: cleanCatalystSentence(sentence),
        topics,
        polarity,
        score: baseScore + eventSpecificity(sentence) + Math.max(-12, Math.min(12, directionFit * 4))
      };
    })
    .filter((item) => item.topics.length && item.score >= 10 && !/\?$|\b(?:could you|can you|wondering if|my question|i'd like to ask)\b/i.test(item.sentence))
    .sort((a, b) => b.score - a.score);
}

function selectEventEvidence(candidates) {
  const primary = candidates[0];
  if (!primary) return [];
  const selected = [primary];
  for (const candidate of candidates.slice(1)) {
    const sharesTopic = candidate.topics.some((topic) => primary.topics.includes(topic));
    const duplicate = selected.some((item) => normalize(item.sentence) === normalize(candidate.sentence));
    if (sharesTopic && !duplicate) selected.push(candidate);
    if (selected.length === 3) break;
  }
  return selected;
}

function concreteCatalyst(evidence, abnormal5d = 0) {
  return rewriteEventSentence(evidence[0] || "Call-specific event could not be verified", abnormal5d);
}

function eventType(sentence) {
  const text = String(sentence || "");
  if (/\b(guidance|outlook|forecast|target|we expect|we are expecting|will be|plan to)\b/i.test(text)) return "forward guidance";
  if (/\b(announced|launched|wind down|stop production|transition|restructur|acqui|divest)\b/i.test(text)) return "strategic action";
  if (/\b(tariff|competition|regulatory|policy uncertainty|supply constraint|shortage)\b/i.test(text)) return "external pressure";
  return "reported operating result";
}

function catalystCategory(catalyst) {
  const text = String(catalyst || "").toLowerCase();
  if (/tariff|competition|interest|cost|compression|pressure/.test(text)) return "cost/competition event";
  if (/margin|profit|loss|cash flow|breakeven/.test(text)) return "margin/profit event";
  if (/demand|deliveries|orders|growth|revenue|backlog/.test(text)) return "demand/growth event";
  if (/capex|investment|capacity|production|factory|supply/.test(text)) return "investment/capacity event";
  if (/launch|robotaxi|ai|fsd|energy|storage|product/.test(text)) return "product/strategy event";
  if (/expect|forecast|guidance|outlook|target/.test(text)) return "guidance event";
  return "call-specific event";
}

async function buildAiTranscriptDriver({ earning, abnormal5d, evidence, fallbackCatalyst }) {
  const prompt = `
You are producing an earnings-call event-study attribution in the style of a formal equity research report.

Task:
Given one earnings-call event, write a concise event driver that explains WHY realized return differed from benchmark-expected return.

Rules:
- Driver must be a short analyst-style event description, not a transcript quote.
- Do not describe only the stock move.
- Do not start with "we expect" or copy a long sentence.
- Name the concrete event, metric, amount and direction when the evidence contains them.
- Distinguish what happened in the reported quarter from what management guided for the next period.
- Do not claim causation more strongly than the transcript and event-window evidence allow.
- Use only the evidence provided.
- Return only JSON with keys: driver, interpretation, confidence.

Event:
Quarter: ${earning.fiscalQuarterEnd || earning.reportedDate}
Call date: ${earning.reportedDate}
5D abnormal return: ${ppt(abnormal5d)}
Fallback driver: ${fallbackCatalyst}

Transcript evidence:
${evidence.map((point, index) => `${index + 1}. ${point}`).join("\n")}
`;
  const result = await fetchOpenAiJson(prompt);
  if (!result?.driver) return null;
  return {
    driver: String(result.driver).slice(0, 180),
    interpretation: String(result.interpretation || "").slice(0, 500),
    confidence: String(result.confidence || "medium").toLowerCase()
  };
}

async function buildTranscriptDriver(earning, abnormal5d, transcript) {
  if (!transcript) return null;
  const sentences = sentenceSplit(transcript.text);
  const candidates = buildEventCandidates(sentences, abnormal5d);
  const selected = selectEventEvidence(candidates);
  const evidence = selected.map((item) => item.sentence);
  if (!evidence.length) return null;
  const catalyst = concreteCatalyst(evidence, abnormal5d);
  const aiDriver = await buildAiTranscriptDriver({ earning, abnormal5d, evidence, fallbackCatalyst: catalyst });
  const finalCatalyst = (aiDriver?.driver || catalyst).replace(/[.]+$/, "");
  const category = catalystCategory(catalyst);
  const primary = selected[0];
  const label = chartDriverLabel(finalCatalyst, primary.sentence);
  const gapDirection = abnormal5d >= 0 ? "positive" : "negative";
  const ruleConfidence = primary.score >= 30 && primary.topics.length >= 2 ? "medium" : "low";
  return {
    headline: finalCatalyst,
    label,
    summary: finalCatalyst,
    interpretation: aiDriver?.interpretation || `The ${gapDirection} realized-vs-expected gap is consistent with investors repricing this ${category}: ${finalCatalyst}. This is transcript-supported event attribution, but it is not proof that the event was the only cause of the 5-day move.`,
    evidence_points: evidence,
    catalyst: finalCatalyst,
    catalyst_category: category,
    event_type: eventType(primary.sentence),
    transcript_url: transcript.url,
    transcript_title: transcript.title,
    transcript_date: transcript.date,
    attribution_source: aiDriver ? "ai-transcript-derived" : "transcript-event-extraction",
    confidence: aiDriver?.confidence || ruleConfidence,
    event_topics: primary.topics,
    event_score: primary.score
  };
}

function findTradingIndex(prices, date) {
  const target = new Date(`${date}T00:00:00`).getTime();
  return prices.findIndex((row) => new Date(`${row.date}T00:00:00`).getTime() >= target);
}

function eventReturn(prices, date, days) {
  const eventIndex = findTradingIndex(prices, date);
  if (eventIndex < 0) return null;
  const preIndex = Math.max(0, eventIndex - 1);
  const endIndex = Math.min(prices.length - 1, eventIndex + days - 1);
  const pre = prices[preIndex];
  const event = prices[eventIndex];
  const end = prices[endIndex];
  if (!pre || !event || !end) return null;
  return {
    pre,
    event,
    end,
    value: (end.close / pre.close) - 1
  };
}

function describeLiveDriver(event, abnormal5d) {
  const epsSurprise = Number(event.surprisePercentage || 0);
  const epsText = Number.isFinite(epsSurprise)
    ? `EPS surprise was ${epsSurprise >= 0 ? "+" : ""}${epsSurprise.toFixed(1)}%.`
    : "EPS surprise data was unavailable.";
  if (Math.abs(abnormal5d) < 0.015) {
    return {
      headline: "Transcript driver not parsed",
      label: "Driver not parsed",
      summary: `${epsText} The 5-day realized move was close to the benchmark-implied move. A transcript-derived driver has not been extracted for this live symbol.`,
      interpretation: "The app can measure the realized-vs-expected price gap, but it should not assign a business cause without transcript evidence."
    };
  }
  return {
    headline: "Transcript driver not parsed",
    label: "Driver not parsed",
    summary: `${epsText} The stock ${abnormal5d >= 0 ? "outperformed" : "underperformed"} the benchmark over the 5-day event window, creating a ${abnormal5d >= 0 ? "positive" : "negative"} realized-vs-expected gap. A transcript-derived reason has not been extracted for this live symbol.`,
    interpretation: "This is a measured price mismatch, not a causal explanation. To identify the true driver, the earnings-call transcript must be parsed for guidance changes, management commentary, Q&A concerns and operating metrics."
  };
}

function summarizeCompany(events) {
  const positives = events.filter((event) => Number(event.abnormal_5d) > 0);
  const negatives = events.filter((event) => Number(event.abnormal_5d) < 0);
  const avgAbnormal = events.reduce((sum, event) => sum + Number(event.abnormal_5d || 0), 0) / Math.max(1, events.length);
  return {
    eventCount: events.length,
    positiveCount: positives.length,
    negativeCount: negatives.length,
    averageAbnormal5d: avgAbnormal,
    averageAbnormal5dLabel: ppt(avgAbnormal),
    strongestPositive: positives.reduce((best, event) => (!best || event.abnormal_5d > best.abnormal_5d ? event : best), null),
    strongestNegative: negatives.reduce((best, event) => (!best || event.abnormal_5d < best.abnormal_5d ? event : best), null),
    latestCall: events[events.length - 1] || null
  };
}

async function buildLiveAnalysis(query) {
  const requestedQuote = await resolveTicker(query);
  const researchCoverage = await selectResearchListing(requestedQuote);
  const quote = researchCoverage.quote;
  const symbol = quote.symbol;
  const requestedSymbol = requestedQuote.symbol;
  const benchmarkSymbol = chooseBenchmark(symbol, quote.exchDisp || quote.exchange);
  const earnings = researchCoverage.earnings;
  const availableEventCount = earnings.length;
  const analysisEarnings = availableEventCount > 8 ? earnings.slice(-8) : earnings;
  const prices = researchCoverage.prices;
  const [benchmarkPrices, transcriptCandidates] = await Promise.all([
    fetchPriceHistory(benchmarkSymbol, "5y").catch(() => []),
    fetchTranscriptCandidates(symbol, quote, analysisEarnings).catch(() => [])
  ]);
  const benchmarkByDate = benchmarkPrices;
  const recentEarnings = analysisEarnings
    .filter((event) => event.reportedDate >= prices[0]?.date && event.reportedDate <= prices[prices.length - 1]?.date)
    .sort((a, b) => new Date(a.reportedDate) - new Date(b.reportedDate));

  const events = (await Promise.all(recentEarnings.map(async (earning, index) => {
    const realized1d = eventReturn(prices, earning.reportedDate, 1);
    const realized3d = eventReturn(prices, earning.reportedDate, 3);
    const realized5d = eventReturn(prices, earning.reportedDate, 5);
    const expected1d = eventReturn(benchmarkByDate, earning.reportedDate, 1);
    const expected3d = eventReturn(benchmarkByDate, earning.reportedDate, 3);
    const expected5d = eventReturn(benchmarkByDate, earning.reportedDate, 5);
    if (!realized5d) return null;
    const exp1 = expected1d?.value || 0;
    const exp3 = expected3d?.value || 0;
    const exp5 = expected5d?.value || 0;
    const abnormal5d = realized5d.value - exp5;
    const transcript = matchTranscriptForEvent(transcriptCandidates, earning);
    const transcriptDriver = await buildTranscriptDriver(earning, abnormal5d, transcript);
    const driver = transcriptDriver || describeLiveDriver(earning, abnormal5d);
    const evidencePoints = transcriptDriver?.evidence_points || [
      `Reported EPS: ${Number.isFinite(earning.reportedEPS) ? earning.reportedEPS : "n/a"} vs consensus ${Number.isFinite(earning.estimatedEPS) ? earning.estimatedEPS : "n/a"}.`,
      `Realized 5D return was ${pct(realized5d.value)} versus benchmark-expected ${pct(exp5)}.`,
      "Transcript evidence has not been parsed for this live search result.",
      `Earnings date source: ${earning.source || "public earnings provider"}${earning.dateConfidence === "fiscal-period-proxy" ? " (fiscal-period proxy, not confirmed call date)" : ""}.`
    ];
    return {
      company: requestedSymbol.toLowerCase(),
      display_name: requestedQuote.longname || requestedQuote.shortname || requestedSymbol,
      quarter: earning.fiscalQuarterEnd || `Event ${index + 1}`,
      call_date: earning.reportedDate,
      transcript_url: transcriptDriver?.transcript_url || earning.transcriptUrl || `https://www.google.com/search?q=${encodeURIComponent(`${quote.longname || symbol} ${earning.fiscalQuarterEnd || ""} earnings call transcript`)}`,
      pre_date: realized5d.pre.date,
      event_trading_date: realized5d.event.date,
      pre_price: realized5d.pre.close,
      event_close: realized5d.event.close,
      realized_1d: realized1d?.value || 0,
      expected_1d: exp1,
      abnormal_1d: (realized1d?.value || 0) - exp1,
      realized_3d: realized3d?.value || 0,
      expected_3d: exp3,
      abnormal_3d: (realized3d?.value || 0) - exp3,
      realized_5d: realized5d.value,
      expected_5d: exp5,
      abnormal_5d: abnormal5d,
      realized_price_5d: realized5d.end.close,
      expected_price_5d: realized5d.pre.close * (1 + exp5),
      end_date_5d: realized5d.end.date,
      headline: driver.headline,
      chart_label: driver.label,
      driver_summary: driver.summary,
      interpretation: driver.interpretation,
      evidence_points: evidencePoints,
      catalyst: driver.catalyst || null,
      catalyst_category: driver.catalyst_category || null,
      event_type: driver.event_type || null,
      event_topics: driver.event_topics || [],
      transcript_title: transcriptDriver?.transcript_title || null,
      transcript_date: transcriptDriver?.transcript_date || null,
      attribution_source: transcriptDriver?.attribution_source || "price-only",
      confidence: transcriptDriver?.confidence || (earning.dateConfidence === "reported" ? "medium" : "low"),
      date_confidence: earning.dateConfidence
    };
  }))).filter(Boolean);

  const dataWarnings = [];
  const transcriptDerivedCount = events.filter((event) => ["transcript-event-extraction", "ai-transcript-derived"].includes(event.attribution_source) || String(event.attribution_source || "").startsWith("transcript-derived")).length;
  const aiDerivedCount = events.filter((event) => event.attribution_source === "ai-transcript-derived").length;
  if (transcriptDerivedCount === events.length && events.length) {
    dataWarnings.push(aiDerivedCount
      ? `Generated AI-assisted transcript drivers for ${aiDerivedCount} of ${events.length} analyzed events.`
      : `Extracted a concrete event and same-topic evidence from public transcripts for all ${events.length} analyzed events. These are preliminary transcript-supported attributions; AI or analyst review is required for PDF-grade causal conclusions.`);
  } else if (transcriptDerivedCount) {
    dataWarnings.push(aiDerivedCount
      ? `Generated AI-assisted transcript drivers for ${aiDerivedCount} events; ${events.length - transcriptDerivedCount} events remain price-only.`
      : `Extracted transcript-supported events for ${transcriptDerivedCount} of ${events.length} analyzed events. Events without matched transcripts remain price-only.`);
  } else {
    dataWarnings.push("Live search currently provides price mismatch analysis only. Earnings-call transcript evidence has not been parsed, so driver attribution is not causal for this symbol.");
  }
  if (availableEventCount > events.length && availableEventCount > 8) {
    dataWarnings.push(`Found ${availableEventCount} available earnings events; analysis uses the latest ${events.length} quarters to prioritize predictive relevance and chart readability.`);
  }
  if (!events.length) {
    dataWarnings.push("The company and live price series were found, but no completed earnings-call event could be matched to the available trading history.");
  }
  if (events.some((event) => event.date_confidence === "fiscal-period-proxy")) {
    dataWarnings.push("Older events may use fiscal quarter-end plus an estimated reporting lag because public reported-date history was unavailable.");
  }
  if (symbol !== requestedSymbol) {
    dataWarnings.unshift(`The searched security ${requestedSymbol} has insufficient trading or earnings history. Event-study history uses the same issuer's primary listing ${symbol} as a disclosed price proxy.`);
  }

  const company = {
    key: requestedSymbol.toLowerCase(),
    live: true,
    displayName: requestedQuote.longname || requestedQuote.shortname || requestedSymbol,
    ticker: `${requestedQuote.exchDisp || requestedQuote.exchange || "Yahoo"}: ${requestedSymbol}`,
    aliases: [requestedSymbol, requestedQuote.shortname, requestedQuote.longname].filter(Boolean),
    events,
    availableEventCount,
    analysisEventCount: events.length,
    analysisWindow: availableEventCount > 8 ? "latest-8-quarters" : "all-available",
    prices,
    requestedSymbol,
    researchSymbol: symbol,
    researchExchange: quote.exchDisp || quote.exchange || "Yahoo",
    usesIssuerPriceProxy: symbol !== requestedSymbol,
    benchmarkSymbol,
    dataWarnings,
    attributionMode: aiDerivedCount ? "ai-transcript" : (transcriptDerivedCount ? "preliminary-transcript-events" : "price-only"),
    summary: summarizeCompany(events)
  };

  return {
    ok: true,
    supported: true,
    analysisAvailable: Boolean(events.length),
    live: true,
    query,
    company,
    methodology: {
      priceSource: `Live Yahoo Finance chart API, with Nasdaq fallback. Research price symbol: ${symbol}.`,
      benchmark: `${benchmarkSymbol} is used as the market proxy for expected return.`,
      eventWindow: "1D, 3D and 5D realized returns are calculated from the pre-event close and compared with benchmark return over the same window.",
      qualitativeAttribution: "Every search queries live public market, earnings and transcript sources. Reported earnings dates are preferred; fiscal-period proxies are disclosed when exact call dates are unavailable. A business driver is assigned only when a matching public transcript can be parsed.",
      displayMetrics: ["realized_5d", "expected_5d", "abnormal_5d"].map((metric) => ({ metric, unit: metric.includes("abnormal") ? "percentage points" : "percent" }))
    }
  };
}

module.exports = async function handler(req, res) {
  try {
    const query = req.query?.q || req.query?.ticker || req.query?.company || "";
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!query.trim()) return res.status(200).json({ ok: true, live: true, supported: false, query: "" });

    const liveResult = await buildLiveAnalysis(query);
    return res.status(200).json(liveResult);
  } catch (error) {
    return res.status(200).json({
      ok: false,
      supported: false,
      live: true,
      query: req.query?.q || req.query?.ticker || req.query?.company || "",
      message: error.message,
      errorCode: "LIVE_SEARCH_FAILED"
    });
  }
};

module.exports._buildLiveAnalysis = buildLiveAnalysis;
module.exports._liveProviders = { resolveTicker, discoverIssuerListings, loadListingCoverage, selectResearchListing, fetchYahooPrices, fetchYahooQuarterlyEps };
module.exports._format = { pct, ppt };
