import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalApi } from "./local-api.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const API = process.env.API_URL || "http://127.0.0.1:8000";
const localApi = createLocalApi(path.join(root, ".data.json"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!filePath.startsWith(root)) {
    send(res, 403, "Forbidden");
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(root, "index.html");
  }
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 500, "Error");
      return;
    }
    send(res, 200, data, { "Content-Type": TYPES[ext] || "application/octet-stream" });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function handleApi(req, res) {
  const raw = await readBody(req);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const backend = await proxyToBackend(req, raw);
  if (backend) {
    res.writeHead(backend.status, backend.headers);
    res.end(backend.body);
    return;
  }
  let parsed = {};
  if (raw.length) {
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      parsed = {};
    }
  }
  const result = await localApi(req, url, parsed);
  send(res, result.status, JSON.stringify(result.data), { "Content-Type": "application/json" });
}

function proxyToBackend(req, raw) {
  return new Promise((resolve) => {
    const target = new URL(req.url, API);
    const headers = { ...req.headers, host: new URL(API).host };
    const proxyReq = http.request(target, { method: req.method, headers }, (proxyRes) => {
      const chunks = [];
      proxyRes.on("data", (c) => chunks.push(c));
      proxyRes.on("end", () => {
        resolve({
          status: proxyRes.statusCode || 502,
          headers: proxyRes.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    proxyReq.on("error", () => resolve(null));
    proxyReq.setTimeout(800, () => {
      proxyReq.destroy();
      resolve(null);
    });
    proxyReq.end(raw);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api")) handleApi(req, res);
  else serveStatic(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`StudioSync listo: http://127.0.0.1:${PORT}`);
});
