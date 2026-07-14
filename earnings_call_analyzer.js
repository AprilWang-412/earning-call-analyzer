const API_URL = window.location.protocol === "file:"
  ? "http://localhost:4173/api/earnings-call-analysis"
  : "api/earnings-call-analysis";

let seed = window.EARNINGS_CALL_SEED || null;
let currentResult = null;
let currentPrices = [];
let currentTimelineHits = [];

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtPct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function fmtPpt(value) {
  const num = Number(value || 0) * 100;
  return `${num >= 0 ? "+" : ""}${num.toFixed(1)}ppt`;
}

function fmtPrice(value) {
  return Number(value || 0).toFixed(2);
}

function fmtDate(value) {
  if (!value) return "--";
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function companyList(data = seed) {
  return Object.entries(data?.companies || {}).map(([key, company]) => ({ key, ...company }));
}

function buildSummary(company) {
  const events = company.events || [];
  const positives = events.filter((event) => Number(event.abnormal_5d) > 0);
  const negatives = events.filter((event) => Number(event.abnormal_5d) < 0);
  const avg = events.reduce((sum, event) => sum + Number(event.abnormal_5d || 0), 0) / Math.max(1, events.length);
  const strongestPositive = events.reduce((best, event) => (
    !best || Number(event.abnormal_5d) > Number(best.abnormal_5d) ? event : best
  ), null);
  const strongestNegative = events.reduce((best, event) => (
    !best || Number(event.abnormal_5d) < Number(best.abnormal_5d) ? event : best
  ), null);
  return {
    eventCount: events.length,
    positiveCount: positives.length,
    negativeCount: negatives.length,
    averageAbnormal5d: avg,
    strongestPositive,
    strongestNegative,
    latestCall: events[events.length - 1]
  };
}

function findCompany(data, query) {
  const q = normalize(query);
  if (!q) return null;
  return companyList(data).find((company) => {
    const aliases = company.aliases || [];
    return normalize(company.key) === q ||
      normalize(company.displayName).includes(q) ||
      normalize(company.ticker).includes(q) ||
      aliases.some((alias) => normalize(alias) === q || normalize(alias).includes(q));
  });
}

async function getAnalysis(query) {
  try {
    const response = await fetch(`${API_URL}?q=${encodeURIComponent(query)}&_=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      if (data.ok) return data;
    }
  } catch (error) {
    // Local file:// previews cannot call the API; fall back to the embedded seed.
  }

  const company = findCompany(seed, query);
  return {
    ok: true,
    supported: Boolean(company),
    query,
    company,
    supportedCompanies: companyList(seed).map(({ key, displayName, ticker, aliases }) => ({ key, displayName, ticker, aliases })),
    methodology: seed?.methodology || {}
  };
}

async function getPriceSeries(company) {
  if (!company?.key) return [];
  if (Array.isArray(company.prices) && company.prices.length) {
    return normalizePrices(company.prices, company.events || []);
  }
  try {
    const response = await fetch(`data/earnings_calls/${company.key}_prices.json`);
    if (!response.ok) return [];
    const payload = await response.json();
    return normalizePrices(payload.data || [], company.events || []);
  } catch (error) {
    return [];
  }
}

function normalizePrices(rows, events) {
  const firstCall = events
    .map((event) => event.call_date)
    .sort()[0];
  return rows
    .map((row) => ({
      date: row.t || row.date,
      close: Number(row.c ?? row.close),
      volume: Number(row.v || 0)
    }))
    .filter((row) => row.date && Number.isFinite(row.close) && (!firstCall || row.date >= firstCall))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function setStatus(kind, message) {
  const box = $("status-box");
  box.hidden = false;
  box.innerHTML = `<strong>${escapeHtml(kind)}</strong> <span>${escapeHtml(message)}</span>`;
}

function drawBars(canvas, events, mode) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const margin = { left: 54, right: 18, top: 28, bottom: 58 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const values = events.flatMap((event) => mode === "realizedExpected"
    ? [Number(event.realized_5d), Number(event.expected_5d)]
    : [Number(event.abnormal_5d)]
  );
  const min = Math.min(-0.08, ...values);
  const max = Math.max(0.08, ...values);

  function y(value) {
    return margin.top + (max - value) / (max - min) * plotH;
  }

  ctx.strokeStyle = "#dbe3ef";
  ctx.lineWidth = 1;
  ctx.font = "12px Arial";
  ctx.fillStyle = "#64748b";
  [-0.2, -0.1, 0, 0.1, 0.2].forEach((tick) => {
    if (tick < min || tick > max) return;
    const yy = y(tick);
    ctx.beginPath();
    ctx.moveTo(margin.left, yy);
    ctx.lineTo(width - margin.right, yy);
    ctx.stroke();
    ctx.fillText(`${Math.round(tick * 100)}%`, 10, yy + 4);
  });

  const zero = y(0);
  ctx.strokeStyle = "#475569";
  ctx.beginPath();
  ctx.moveTo(margin.left, zero);
  ctx.lineTo(width - margin.right, zero);
  ctx.stroke();

  const groupW = plotW / events.length;
  events.forEach((event, index) => {
    const center = margin.left + index * groupW + groupW / 2;
    if (mode === "realizedExpected") {
      [
        { value: Number(event.realized_5d), color: "#1d4ed8", x: center - 12 },
        { value: Number(event.expected_5d), color: "#94a3b8", x: center + 12 }
      ].forEach((bar) => {
        const yy = y(bar.value);
        ctx.fillStyle = bar.color;
        ctx.fillRect(bar.x - 8, Math.min(yy, zero), 16, Math.abs(zero - yy));
      });
    } else {
      const value = Number(event.abnormal_5d);
      const yy = y(value);
      ctx.fillStyle = value >= 0 ? "#13805f" : "#b42318";
      ctx.fillRect(center - 13, Math.min(yy, zero), 26, Math.abs(zero - yy));
      ctx.fillStyle = "#334155";
      ctx.font = "11px Arial";
      ctx.fillText(fmtPpt(value), center - 22, yy + (value >= 0 ? -6 : 15));
    }

    ctx.save();
    ctx.translate(center - 10, height - 14);
    ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = "#475569";
    ctx.font = "11px Arial";
    ctx.fillText(event.quarter, 0, 0);
    ctx.restore();
  });

  if (mode === "realizedExpected") {
    ctx.fillStyle = "#1d4ed8";
    ctx.fillRect(width - 178, 18, 10, 10);
    ctx.fillStyle = "#334155";
    ctx.font = "12px Arial";
    ctx.fillText("Realized 5D", width - 162, 27);
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(width - 88, 18, 10, 10);
    ctx.fillStyle = "#334155";
    ctx.fillText("Expected", width - 72, 27);
  }
}

function drawPriceTimeline(canvas, prices, events) {
  if (!canvas) return;
  currentTimelineHits = [];
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (!prices.length) {
    ctx.fillStyle = "#64748b";
    ctx.font = "14px Arial";
    ctx.fillText("No local price series available for this stock yet.", 24, 42);
    return;
  }

  const margin = { left: 62, right: 28, top: 34, bottom: 54 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const minPrice = Math.min(...prices.map((row) => row.close));
  const maxPrice = Math.max(...prices.map((row) => row.close));
  const pad = Math.max(1, (maxPrice - minPrice) * 0.12);
  const min = minPrice - pad;
  const max = maxPrice + pad;
  const dates = prices.map((row) => new Date(`${row.date}T00:00:00`).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);

  function x(date) {
    const time = new Date(`${date}T00:00:00`).getTime();
    if (maxDate === minDate) return margin.left;
    return margin.left + ((time - minDate) / (maxDate - minDate)) * plotW;
  }

  function y(value) {
    return margin.top + ((max - value) / (max - min)) * plotH;
  }

  ctx.strokeStyle = "#dbe3ef";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#64748b";
  ctx.font = "12px Arial";
  for (let i = 0; i <= 4; i += 1) {
    const value = min + ((max - min) * i) / 4;
    const yy = y(value);
    ctx.beginPath();
    ctx.moveTo(margin.left, yy);
    ctx.lineTo(width - margin.right, yy);
    ctx.stroke();
    ctx.fillText(fmtPrice(value), 12, yy + 4);
  }

  const tickCount = Math.min(5, prices.length);
  for (let i = 0; i < tickCount; i += 1) {
    const index = Math.round((prices.length - 1) * (i / Math.max(1, tickCount - 1)));
    const row = prices[index];
    const xx = x(row.date);
    ctx.fillStyle = "#64748b";
    ctx.fillText(row.date.slice(0, 7), xx - 20, height - 22);
  }

  ctx.strokeStyle = "#1d4ed8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  prices.forEach((row, index) => {
    const xx = x(row.date);
    const yy = y(row.close);
    if (index === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  });
  ctx.stroke();

  const priceByDate = new Map(prices.map((row) => [row.date, row]));
  const laneY = [
    margin.top + 16,
    height - margin.bottom - 42,
    margin.top + 58,
    height - margin.bottom - 84,
    margin.top + 100,
    height - margin.bottom - 126
  ];
  const laneLastX = laneY.map(() => -Infinity);
  const minLaneGap = Math.min(210, Math.max(125, plotW / Math.max(2, events.length - 1) * 0.85));

  events.forEach((event) => {
    const row = priceByDate.get(event.event_trading_date) || priceByDate.get(event.call_date);
    if (!row) return;
    const xx = x(row.date);
    const yy = y(row.close);
    const positive = Number(event.abnormal_5d) >= 0;
    const color = positive ? "#13805f" : "#b42318";
    let laneIndex = 0;
    for (let i = 0; i < laneY.length; i += 1) {
      if (xx - laneLastX[i] >= minLaneGap) {
        laneIndex = i;
        break;
      }
    }
    laneLastX[laneIndex] = xx;

    ctx.strokeStyle = "rgba(71, 85, 105, 0.42)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xx, margin.top);
    ctx.lineTo(xx, height - margin.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(xx, yy, 5, 0, Math.PI * 2);
    ctx.fill();

    const text = `${event.quarter}: ${event.chart_label || event.headline || "Earnings-call driver"}`;
    const maxTextWidth = Math.min(230, Math.max(160, plotW / 4));
    const boxX = Math.min(Math.max(xx - maxTextWidth / 2, margin.left), width - margin.right - maxTextWidth);
    const boxY = laneY[laneIndex];
    ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    roundRect(ctx, boxX, boxY, maxTextWidth, 30, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.font = "11px Arial";
    drawEllipsized(ctx, text, boxX + 8, boxY + 19, maxTextWidth - 16);
    currentTimelineHits.push({
      event,
      dot: { x: xx, y: yy, r: 13 },
      box: { x: boxX, y: boxY, width: maxTextWidth, height: 30 }
    });
  });
}

function renderTimelineDetail(event) {
  const root = $("timeline-detail");
  if (!root || !event) return;
  const positive = Number(event.abnormal_5d) >= 0;
  root.innerHTML = `
    <div class="timeline-detail-header">
      <strong>${escapeHtml(event.quarter)} | ${escapeHtml(event.headline)}</strong>
      <span class="${positive ? "good" : "bad"}">${escapeHtml(fmtPpt(event.abnormal_5d))}</span>
    </div>
    <p>${escapeHtml(event.driver_summary)}</p>
    ${event.event_type ? `<p><strong>Event type:</strong> ${escapeHtml(event.event_type)} | <strong>Attribution confidence:</strong> ${escapeHtml(event.confidence || "--")}</p>` : ""}
    <p><strong>Realized vs expected:</strong> ${escapeHtml(fmtPct(event.realized_5d))} realized 5D vs ${escapeHtml(fmtPct(event.expected_5d))} expected 5D.</p>
  `;
}

function handleTimelineClick(event) {
  const canvas = $("price-timeline");
  if (!canvas || !currentTimelineHits.length) return;
  const rect = canvas.getBoundingClientRect();
  const xPos = event.clientX - rect.left;
  const yPos = event.clientY - rect.top;
  const hit = currentTimelineHits.find((item) => {
    const inBox = xPos >= item.box.x && xPos <= item.box.x + item.box.width &&
      yPos >= item.box.y && yPos <= item.box.y + item.box.height;
    const dotDistance = Math.hypot(xPos - item.dot.x, yPos - item.dot.y);
    return inBox || dotDistance <= item.dot.r;
  });
  if (hit) renderTimelineDetail(hit.event);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawEllipsized(ctx, text, x, y, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return;
  }
  let next = text;
  while (next.length > 4 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1);
  }
  ctx.fillText(`${next}...`, x, y);
}

function buildReport(company, events, prices) {
  const start = prices[0];
  const end = prices[prices.length - 1];
  const transcriptDerived = company.attributionMode !== "price-only" &&
    events.some((event) => ["transcript-event-extraction", "ai-transcript-derived"].includes(event.attribution_source) || String(event.attribution_source || "").startsWith("transcript-derived"));
  const preliminary = company.attributionMode === "preliminary-transcript-events" || company.attributionMode === "rules-public-transcripts";
  const availableEventCount = Number(company.availableEventCount || events.length);
  const analysisWindowText = availableEventCount > events.length
    ? `This report analyzes the latest ${events.length} of ${availableEventCount} available earnings-call events under the latest-eight-quarter rule.`
    : `This report analyzes all ${events.length} available earnings-call events.`;
  const totalReturn = start && end ? (end.close / start.close) - 1 : null;
  const biggestGap = events.reduce((best, event) => (
    !best || Math.abs(Number(event.abnormal_5d)) > Math.abs(Number(best.abnormal_5d)) ? event : best
  ), null);
  const positiveEvents = events.filter((event) => Number(event.abnormal_5d) > 0);
  const negativeEvents = events.filter((event) => Number(event.abnormal_5d) < 0);
  const avgGap = events.reduce((sum, event) => sum + Number(event.abnormal_5d || 0), 0) / Math.max(1, events.length);

  const driverParagraph = transcriptDerived
    ? `
      <p>
        The average realized-vs-expected 5-day gap is ${escapeHtml(fmtPpt(avgGap))}. The largest gap was
        ${escapeHtml(biggestGap?.quarter || "--")} (${escapeHtml(fmtPpt(biggestGap?.abnormal_5d))}). The ${preliminary ? "primary event extracted from" : "event driver identified in"} the call was:
        ${escapeHtml(biggestGap?.catalyst || biggestGap?.driver_summary || "--")}
      </p>
      <p>
        Interpretation: the report links each mismatch to a specific transcript event first, then uses the price gap to judge
        whether that event improved or damaged expectations.${preliminary ? " Automated extraction establishes a transcript-supported hypothesis, not proof that this event alone caused the move." : ""}
      </p>
    `
    : `
      <p>
        The average realized-vs-expected 5-day gap is ${escapeHtml(fmtPpt(avgGap))}. The largest measured gap was
        ${escapeHtml(biggestGap?.quarter || "--")} (${escapeHtml(fmtPpt(biggestGap?.abnormal_5d))}).
      </p>
      <p>
        Driver status: this live result has price and earnings-date data, but no parsed earnings-call transcript evidence.
        The app therefore reports the mismatch without assigning a business cause. To produce the PDF-style attribution,
        the transcript needs to be collected and parsed for management commentary, guidance changes, operating metrics and Q&A.
      </p>
    `;

  return `
    <section class="report-block">
      <h3>Analysis Report</h3>
      <p>
        From ${escapeHtml(fmtDate(start?.date))} to ${escapeHtml(fmtDate(end?.date))},
        ${escapeHtml(company.displayName)} moved from ${escapeHtml(fmtPrice(start?.close))} to ${escapeHtml(fmtPrice(end?.close))},
        a total realized price change of ${totalReturn === null ? "--" : escapeHtml(fmtPct(totalReturn))}.
        ${escapeHtml(analysisWindowText)} The event-study sample has ${positiveEvents.length}
        positive and ${negativeEvents.length} negative 5-day abnormal reactions versus the benchmark.
      </p>
      ${driverParagraph}
    </section>
  `;
}

function renderEvent(event) {
  const isPositive = Number(event.abnormal_5d) >= 0;
  const transcriptDerived = ["transcript-event-extraction", "ai-transcript-derived"].includes(event.attribution_source) || String(event.attribution_source || "").startsWith("transcript-derived");
  const preliminary = event.attribution_source === "transcript-event-extraction";
  const source = event.transcript_url
    ? `<a href="${escapeHtml(event.transcript_url)}" target="_blank" rel="noopener noreferrer">transcript</a>`
    : "";
  return `
    <article class="event ${isPositive ? "positive" : "negative"}">
      <h4>${escapeHtml(event.quarter)} | ${escapeHtml(event.headline)}</h4>
      <span class="pill ${isPositive ? "good" : "bad"}">Abnormal 5D: ${escapeHtml(fmtPpt(event.abnormal_5d))}</span>
      <span class="pill">Realized: ${escapeHtml(fmtPct(event.realized_5d))}</span>
      <span class="pill">Expected: ${escapeHtml(fmtPct(event.expected_5d))}</span>
      <span class="pill">Realized price: ${escapeHtml(fmtPrice(event.realized_price_5d))}</span>
      <span class="pill">Expected price: ${escapeHtml(fmtPrice(event.expected_price_5d))}</span>
      <span class="pill">Call date: ${escapeHtml(event.call_date)}</span>
      ${event.event_type ? `<span class="pill">Event type: ${escapeHtml(event.event_type)}</span>` : ""}
      ${event.confidence ? `<span class="pill">Confidence: ${escapeHtml(event.confidence)}</span>` : ""}
      <p><strong>${transcriptDerived ? (preliminary ? "Primary transcript event:" : "Driver:") : "Measured mismatch:"}</strong> ${escapeHtml(event.catalyst || event.driver_summary)}</p>
      <p><strong>Interpretation:</strong> ${escapeHtml(event.interpretation)}</p>
      <p><strong>${transcriptDerived ? "Transcript evidence:" : "Available evidence:"}</strong></p>
      <ul>${(event.evidence_points || []).map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>
      <p>${source}</p>
    </article>
  `;
}

function renderUnsupported(result) {
  const supported = (result.supportedCompanies || []).map((company) => company.displayName).join(", ");
  $("analysis-root").innerHTML = `
    <section class="card unsupported">
      <h3>No complete live event-study result for "${escapeHtml(result.query)}" yet</h3>
      <p>${escapeHtml(result.message || "The live data providers did not return enough price and earnings-call data for this symbol.")}</p>
      <p>Local curated coverage is still available for: ${escapeHtml(supported)}.</p>
      <p>Try one of these next steps:</p>
      <ol>
        ${(result.nextProviderSteps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
      </ol>
    </section>
  `;
}

function renderCompany(result) {
  const company = result.company;
  const events = company.events || [];
  const summary = company.summary || buildSummary(company);
  const latest = summary.latestCall || events[events.length - 1];
  const warnings = company.dataWarnings || [];
  const availableEventCount = Number(company.availableEventCount || events.length);
  const analysisEventCount = Number(company.analysisEventCount || events.length);
  const eventLabel = availableEventCount > analysisEventCount
    ? `Analyzing ${analysisEventCount} of ${availableEventCount} available earnings-call events`
    : `Analyzing ${analysisEventCount} earnings-call events`;
  const windowLabel = company.analysisWindow === "latest-8-quarters" ? "Latest 8 quarters" : "All available calls";
  const attributionLabel = company.attributionMode === "ai-transcript"
    ? "AI transcript drivers"
    : company.attributionMode === "preliminary-transcript-events" || company.attributionMode === "rules-public-transcripts"
      ? "Preliminary transcript events"
      : company.attributionMode === "transcript-derived"
        ? "Curated transcript drivers"
        : "Price-only";

  const prices = currentPrices || [];
  $("analysis-root").innerHTML = `
    <section class="analysis-header">
      <h2>${escapeHtml(company.displayName)}</h2>
      <p>${escapeHtml(company.ticker)} | ${escapeHtml(eventLabel)} | Latest call: ${escapeHtml(latest?.quarter || "--")} (${escapeHtml(latest?.call_date || "--")})</p>
      <div class="summary-grid">
        <div class="metric"><span>Analyzed events</span><strong>${analysisEventCount}</strong></div>
        <div class="metric"><span>Analysis window</span><strong>${escapeHtml(windowLabel)}</strong></div>
        <div class="metric"><span>Driver mode</span><strong>${escapeHtml(attributionLabel)}</strong></div>
        <div class="metric"><span>Positive 5D abnormal</span><strong>${summary.positiveCount}</strong></div>
        <div class="metric"><span>Negative 5D abnormal</span><strong>${summary.negativeCount}</strong></div>
        <div class="metric"><span>Avg abnormal 5D</span><strong>${escapeHtml(fmtPpt(summary.averageAbnormal5d))}</strong></div>
      </div>
    </section>

    ${warnings.length ? `
      <section class="notice warning">
        <strong>Data note.</strong>
        <span>${warnings.map(escapeHtml).join(" ")}</span>
      </section>
    ` : ""}

    <section class="card">
      <div class="section-title-row">
        <h3>Price Timeline with Earnings-Call Drivers</h3>
        <span>${escapeHtml(fmtDate(prices[0]?.date))} - ${escapeHtml(fmtDate(prices[prices.length - 1]?.date))}</span>
      </div>
      <canvas id="price-timeline"></canvas>
      <div class="annotation-note">
        Markers show each earnings call date. Click a marker or label to inspect the full driver and realized-vs-expected gap.
      </div>
      <div class="timeline-detail" id="timeline-detail"></div>
    </section>

    <section class="grid two">
      <article class="card">
        <h3>Realized vs Expected 5D Return</h3>
        <canvas id="realized-chart"></canvas>
      </article>
      <article class="card">
        <h3>Abnormal 5D Return by Call</h3>
        <canvas id="abnormal-chart"></canvas>
      </article>
    </section>

    <section class="card">
      <h3>Earnings Call Analysis</h3>
      <div class="event-list">${[...events].reverse().map(renderEvent).join("")}</div>
    </section>

    ${buildReport(company, events, prices)}
  `;

  requestAnimationFrame(() => {
    drawPriceTimeline($("price-timeline"), prices, events);
    $("price-timeline").onclick = handleTimelineClick;
    renderTimelineDetail(events[events.length - 1]);
    drawBars($("realized-chart"), events, "realizedExpected");
    drawBars($("abnormal-chart"), events, "abnormal");
  });
}

async function runSearch(query) {
  const q = String(query || $("stock-query").value || "").trim();
  if (!q) {
    setStatus("Missing input.", "Type a company name or ticker first.");
    return;
  }
  setStatus("Generating.", `Running earnings-call analysis for ${q}...`);
  const result = await getAnalysis(q);
  if (!result.supported) {
    setStatus("Provider required.", "This stock is not in the local earnings-call dataset yet.");
    renderUnsupported(result);
    return;
  }
  currentResult = result;
  currentPrices = await getPriceSeries(result.company);
  setStatus("Analysis ready.", `Generated event-study analysis for ${result.company.displayName}.`);
  renderCompany(result);
}

function init() {
  $("analysis-root").innerHTML = "";
  $("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch();
  });
  $("stock-query").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch();
    }
  });
}

window.addEventListener("resize", () => {
  if (currentResult?.company) {
    drawPriceTimeline($("price-timeline"), currentPrices || [], currentResult.company.events || []);
    drawBars($("realized-chart"), currentResult.company.events || [], "realizedExpected");
    drawBars($("abnormal-chart"), currentResult.company.events || [], "abnormal");
  }
});

init();
