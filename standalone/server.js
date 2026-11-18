// Standalone runner for the dashboards in ../dashboards.
//
// - Serves the runner page (./public) and the dashboard files (../dashboards).
// - Exposes POST /api/incorta/call, which forwards one read-only tool call to the
//   Incorta MCP server over MCP Streamable HTTP (JSON-RPC), adding your Incorta
//   credentials from environment variables. The browser never sees the token.
//
// Run:  node --env-file=.env server.js     (Node 20.6+; no npm install needed)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const MCP_URL = process.env.INCORTA_MCP_URL;

// Headers the Incorta MCP server expects on every request.
const INCORTA_HEADERS = {
  Authorization: process.env.INCORTA_ENV_URL,   // the Incorta environment URL
  'X-Tenant': process.env.INCORTA_TENANT,
  'X-Token': process.env.INCORTA_TOKEN,
  'X-Account-Id': process.env.INCORTA_ACCOUNT_ID // needed only for run_sql
};

// Only these read-only Incorta MCP tools can be called through this server.
const ALLOWED_TOOLS = new Set(['list_schemas', 'get_schema', 'get_table', 'query_business_view', 'run_sql']);

const ROOT = __dirname;
const STATIC_DIRS = {
  '/dashboards/': path.join(ROOT, '..', 'dashboards'),
  '/': path.join(ROOT, 'public')
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

// ---------------------------------------------------------------- MCP client

let session = null;      // { id, initialized: Promise }
let nextId = 1;

function mcpHeaders() {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  for (const [k, v] of Object.entries(INCORTA_HEADERS)) if (v) h[k] = v;
  if (session && session.id) h['Mcp-Session-Id'] = session.id;
  return h;
}

// Reads a JSON-RPC response that may come back as plain JSON or as an SSE stream.
async function readRpc(res, id) {
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!res.ok) throw new Error(`Incorta MCP server answered HTTP ${res.status}: ${text.slice(0, 500)}`);
  if (type.includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      const msg = JSON.parse(data);
      if (msg.id === id) return msg;
    }
    throw new Error('No response for the request in the Incorta MCP event stream');
  }
  return text ? JSON.parse(text) : null;
}

async function rpc(method, params, { notify = false } = {}) {
  const body = { jsonrpc: '2.0', method, params };
  const id = notify ? undefined : nextId++;
  if (!notify) body.id = id;
  const res = await fetch(MCP_URL, { method: 'POST', headers: mcpHeaders(), body: JSON.stringify(body) });
  if (method === 'initialize') {
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.id = sid;
  }
  if (notify) { await res.text(); return null; }
  const msg = await readRpc(res, id);
  if (msg && msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
  return msg ? msg.result : null;
}

function ensureSession() {
  if (session) return session.initialized;
  session = { id: null, initialized: null };
  session.initialized = (async () => {
    await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'incorta-claude-dashboards', version: '1.0.0' }
    });
    await rpc('notifications/initialized', {}, { notify: true });
  })().catch((err) => { session = null; throw err; });
  return session.initialized;
}

// Calls one tool and returns its answer, parsed from JSON where it is JSON.
async function callTool(name, args) {
  await ensureSession();
  let result;
  try {
    result = await rpc('tools/call', { name, arguments: args || {} });
  } catch (err) {
    // A lost session (server restart, timeout): start a new one and try once more.
    if (/HTTP 404|session/i.test(String(err.message))) {
      session = null;
      await ensureSession();
      result = await rpc('tools/call', { name, arguments: args || {} });
    } else {
      throw err;
    }
  }
  const text = (result && Array.isArray(result.content) ? result.content : [])
    .filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (result && result.isError) throw new Error(text || `Incorta MCP tool ${name} failed`);
  if (result && result.structuredContent) return result.structuredContent;
  try { return JSON.parse(text); } catch { return text; }
}

// ---------------------------------------------------------------- HTTP server

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!urlPath.startsWith(prefix)) continue;
    let rel = decodeURIComponent(urlPath.slice(prefix.length)) || 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir + path.sep) && file !== dir) return send(res, 403, { error: 'Forbidden' });
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, { error: 'Not found' });
      send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
    });
    return;
  }
  send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/incorta/call') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
    if (!MCP_URL) return send(res, 500, { error: 'INCORTA_MCP_URL is not set. Copy .env.example to .env and fill it in.' });
    try {
      const { tool, args } = JSON.parse(await readBody(req));
      if (!ALLOWED_TOOLS.has(tool)) return send(res, 400, { error: `Tool not allowed: ${tool}` });
      const answer = await callTool(tool, args);
      send(res, 200, { answer });
    } catch (err) {
      send(res, 502, { error: String(err && err.message || err) });
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Incorta dashboards on http://${HOST}:${PORT}/?dashboard=gifts-donations`);
  if (!MCP_URL) console.warn('INCORTA_MCP_URL is not set: dashboards will show "Failed to load" until it is.');
});
