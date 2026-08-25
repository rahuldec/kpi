#!/usr/bin/env node
/* Local dev server — static files + /api/data, no Vercel CLI.
   Usage: node scripts/dev-server.js
   Optional: PORT=3000 node scripts/dev-server.js
   Loads .env.local then .env from the project root (KEY=value, # comments). */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function loadEnv(file) {
  const p = path.join(ROOT, file);
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (_) { /* optional file */ }
}

loadEnv('.env.local');
loadEnv('.env');

const dataHandler = require(path.join(ROOT, 'api', 'data.js'));
const zohoUserHandler = require(path.join(ROOT, 'api', 'zoho-user.js'));

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(ROOT, normalized);
  if (!full.startsWith(ROOT + path.sep) && full !== ROOT) return null;
  return full;
}

function serveStatic(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

function runApiHandler(handler, req, res, url) {
  const mockReq = {
    method: req.method,
    url: url.pathname + url.search,
    query: Object.fromEntries(url.searchParams),
    headers: req.headers,
  };
  let statusCode = 200;
  const headers = {};

  const mockRes = {
    setHeader(k, v) { headers[k] = v; },
    status(code) { statusCode = code; return mockRes; },
    send(body) {
      res.writeHead(statusCode, headers);
      res.end(typeof body === 'string' ? body : String(body));
    },
    json(obj) {
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json; charset=utf-8';
      mockRes.send(JSON.stringify(obj));
    },
  };

  Promise.resolve(handler(mockReq, mockRes)).catch((e) => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  });
}

const server = http.createServer((req, res) => {
  const host = req.headers.host || '';
  if (host.startsWith('127.0.0.1')) {
    res.writeHead(301, { Location: 'http://localhost:' + PORT + (req.url || '/') });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }

  if (url.pathname === '/api/data') {
    runApiHandler(dataHandler, req, res, url);
    return;
  }

  if (url.pathname === '/api/zoho-user') {
    runApiHandler(zohoUserHandler, req, res, url);
    return;
  }

  let filePath = safePath(url.pathname === '/' ? '/index.html' : url.pathname);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  if (req.method === 'HEAD') {
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end();
    });
    return;
  }

  serveStatic(req, res, filePath);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`KPI dev server → http://localhost:${PORT}/`);
  console.log('(127.0.0.1 redirects to localhost for Zoho OAuth.)');
  console.log('Press Ctrl+C to stop.');
});
