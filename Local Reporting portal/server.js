'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const msal = require('@azure/msal-node');
const { PBI, USERS, TOKEN_REFRESH_SKEW_MS, PORT, SESSION_SECRET, assertConfig } = require('./config');

assertConfig();

// ─────────────────────────────────────────────────────────────
//  AAD client-credentials (service principal). MSAL caches the
//  AAD token internally and only calls AAD when it is near expiry.
// ─────────────────────────────────────────────────────────────
const cca = new msal.ConfidentialClientApplication({
  auth: {
    clientId: PBI.clientId,
    authority: `https://login.microsoftonline.com/${PBI.tenantId}`,
    clientSecret: PBI.clientSecret,
  },
});

async function getAadToken() {
  const result = await cca.acquireTokenByClientCredential({ scopes: [PBI.scope] });
  if (!result || !result.accessToken) throw new Error('Failed to acquire AAD token');
  return result.accessToken;
}

// ─────────────────────────────────────────────────────────────
//  In-memory caches (POC). Reset on restart.
//  - embedTokenCache: per-user embed token, reused until ~5 min before expiry.
//  - reportInfo:      the report embedUrl, fetched once (never changes).
// ─────────────────────────────────────────────────────────────
const embedTokenCache = new Map(); // email -> { token, tokenId, expiration(Date) }
let reportInfo = null; // { embedUrl }
let generateTokenCount = 0; // how many trial tokens we have burned this process

const GEN_LOG = path.join(__dirname, 'generate-token.log');

function logGenerateToken(email, role, tokenId, expiration) {
  generateTokenCount += 1;
  const line = `${new Date().toISOString()}  #${generateTokenCount}  user=${email}  role="${role}"  tokenId=${tokenId}  expires=${expiration}`;
  console.log(`[GenerateToken] ${line}`);
  try {
    fs.appendFileSync(GEN_LOG, line + '\n');
  } catch (_) {
    /* logging is best-effort */
  }
}

async function pbiFetch(url, aadToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${aadToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_) {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Power BI API ${res.status}: ${body.error?.message || text || res.statusText}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function getReportEmbedUrl(aadToken) {
  if (reportInfo) return reportInfo;
  const report = await pbiFetch(
    `${PBI.apiRoot}/groups/${PBI.workspaceId}/reports/${PBI.reportId}`,
    aadToken
  );
  reportInfo = { embedUrl: report.embedUrl };
  return reportInfo;
}

// Generate an app-owns-data embed token bound to ONE static RLS role.
async function generateEmbedToken(aadToken, email, role) {
  const body = {
    reports: [{ id: PBI.reportId }],
    datasets: [{ id: PBI.datasetId }],
    identities: [
      {
        username: email, // arbitrary label for a static role; roles[] is what filters
        roles: [role],
        datasets: [PBI.datasetId],
      },
    ],
  };
  const result = await pbiFetch(`${PBI.apiRoot}/GenerateToken`, aadToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  logGenerateToken(email, role, result.tokenId, result.expiration);
  return { token: result.token, tokenId: result.tokenId, expiration: new Date(result.expiration) };
}

// Return a valid cached token or mint a fresh one. THE token-conservation core.
// An in-flight promise per user de-dupes concurrent requests (two tabs, a reload
// during the mint window, simultaneous tokenExpired events) so they share ONE
// GenerateToken call instead of each burning a trial token.
const inflight = new Map(); // email -> Promise<{token, tokenId, expiration}>

async function getEmbedTokenForUser(email, role) {
  const now = Date.now();
  const cached = embedTokenCache.get(email);
  if (cached && cached.expiration.getTime() - TOKEN_REFRESH_SKEW_MS > now) {
    return { ...cached, cached: true };
  }
  if (inflight.has(email)) {
    const shared = await inflight.get(email);
    return { ...shared, cached: false };
  }
  const p = (async () => {
    const aadToken = await getAadToken();
    return generateEmbedToken(aadToken, email, role);
  })();
  inflight.set(email, p);
  try {
    const fresh = await p; // if this rejects, the cache is NOT poisoned
    embedTokenCache.set(email, fresh);
    return { ...fresh, cached: false };
  } finally {
    inflight.delete(email);
  }
}

// ─────────────────────────────────────────────────────────────
//  Express app
// ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// POST /api/login  { email, password }
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const key = String(email || '').toLowerCase().trim();
  const user = USERS[key];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  // Regenerate the session id on auth to avoid session fixation.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    req.session.user = { email: key, role: user.role };
    req.session.save(() => res.json(req.session.user));
  });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/me
app.get('/api/me', requireAuth, (req, res) => res.json(req.session.user));

// GET /api/embed-config  → embed token (cached) + embedUrl + reportId
app.get('/api/embed-config', requireAuth, async (req, res) => {
  try {
    const { email, role } = req.session.user;
    const aadToken = await getAadToken();
    const { embedUrl } = await getReportEmbedUrl(aadToken);
    const tok = await getEmbedTokenForUser(email, role);
    res.json({
      embedUrl,
      reportId: PBI.reportId,
      embedToken: tok.token,
      expiration: tok.expiration,
      role,
      fromCache: tok.cached,
      generateTokenCount,
    });
  } catch (e) {
    // Full diagnostics stay server-side; the browser gets a generic message.
    console.error('[embed-config]', e.status || '', e.message, e.body?.error || '');
    res.status(500).json({ error: 'Failed to load report' });
  }
});

// GET /api/token-usage  → embedTrial pool state + our own GenerateToken counter
app.get('/api/token-usage', requireAuth, async (req, res) => {
  try {
    const aadToken = await getAadToken();
    const feats = await pbiFetch(`${PBI.apiRoot}/availableFeatures`, aadToken);
    const embedTrial = (feats.features || []).find((f) => f.name === 'embedTrial') || null;
    // The trial's usage is a percentage (0-100) of the monthly free embed-token
    // allotment, reported under additionalInfo.usage.
    let percentage = null;
    const usage = embedTrial && embedTrial.additionalInfo ? embedTrial.additionalInfo.usage : undefined;
    if (typeof usage === 'number') percentage = usage;
    res.json({
      embedTrial, // raw object: { name, state, additionalInfo: { usage }, ... }
      percentage, // trial usage % (0-100), or null if unavailable
      generateTokenCount, // trial tokens this process has burned
    });
  } catch (e) {
    console.error('[token-usage]', e.status || '', e.message);
    res.status(500).json({ error: 'Failed to load usage' });
  }
});

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/login.html'));

app.listen(PORT, () => {
  console.log(`\n  Power BI embed POC (static RLS) running:  http://localhost:${PORT}`);
  console.log(`  Report:   ${PBI.reportId}`);
  console.log(`  Dataset:  ${PBI.datasetId}`);
  console.log(`  Users:    ${Object.keys(USERS).join(', ')}`);
  console.log(`  Every GenerateToken call is logged here and to generate-token.log\n`);
});
