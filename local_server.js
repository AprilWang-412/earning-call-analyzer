const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const handler = require("./api/earnings-call-analysis");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf"
};

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    ...headers
  });
  res.end(body);
}

function serveFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/earnings_call_analyzer.html" : url.pathname);
  const target = path.normalize(path.join(ROOT, pathname));
  if (!target.startsWith(ROOT)) {
    send(res, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  fs.readFile(target, (error, body) => {
    if (error) {
      send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    send(res, 200, body, { "Content-Type": MIME[path.extname(target)] || "application/octet-stream" });
  });
}

function makeApiResponse(res) {
  return {
    setHeader(name, value) {
      res.setHeader(name, value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      const body = JSON.stringify(payload);
      send(res, this.statusCode || 200, body, { "Content-Type": "application/json; charset=utf-8" });
    }
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/earnings-call-analysis") {
    const query = Object.fromEntries(url.searchParams.entries());
    await handler({ query, method: req.method }, makeApiResponse(res));
    return;
  }
  serveFile(req, res);
});

server.listen(PORT, () => {
  console.log(`Earnings call analyzer running at http://localhost:${PORT}/earnings_call_analyzer.html`);
});
