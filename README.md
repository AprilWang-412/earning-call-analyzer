# Earning Call Analyzer

A browser-based earnings call event-study tool. Search by ticker or company name to compare realized and benchmark-expected returns, extract transcript-supported event drivers, and generate an eight-quarter analysis report.

## Run locally

Requires Node.js 18 or newer.

```bash
npm run dev
```

Open [http://localhost:4173/earnings_call_analyzer.html](http://localhost:4173/earnings_call_analyzer.html).

## Analysis window

- Stocks with more than eight available earnings calls use the latest eight quarters.
- Stocks with eight or fewer available calls use all available quarters.
- Live searches use public price, earnings-date, and transcript sources when available.
- Transcript event extraction is presented as a supported attribution hypothesis, not proof that one event was the sole cause of a stock move.

Set `OPENAI_API_KEY` before starting the server to enable AI-assisted driver writing. Without it, the application uses its deterministic transcript-event extraction pipeline.
