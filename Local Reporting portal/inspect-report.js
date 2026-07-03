'use strict';
// Inspect the PUBLISHED report definition: pages, canvas backgrounds, resources.
require('dotenv').config();
const { PBI } = require('./config');
const msal = require('@azure/msal-node');
const FABRIC = 'https://api.fabric.microsoft.com/v1';
const REPORT = `${FABRIC}/workspaces/${PBI.workspaceId}/reports/${PBI.reportId}`;
const b64dec = (s) => Buffer.from(s, 'base64').toString('utf8');

async function fabricToken() {
  const cca = new msal.ConfidentialClientApplication({
    auth: { clientId: PBI.clientId, authority: `https://login.microsoftonline.com/${PBI.tenantId}`, clientSecret: PBI.clientSecret },
  });
  return (await cca.acquireTokenByClientCredential({ scopes: ['https://api.fabric.microsoft.com/.default'] })).accessToken;
}
async function req(url, token, options = {}) {
  return fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
}
async function pollLro(res, token) {
  if (res.status !== 202) { const t = await res.text(); if (!res.ok) throw new Error(`${res.status}: ${t}`); return t ? JSON.parse(t) : {}; }
  const opUrl = res.headers.get('Location'); let wait = parseInt(res.headers.get('Retry-After') || '2', 10);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    const s = await req(opUrl, token); const body = await s.json().catch(() => ({}));
    if (body.status === 'Succeeded') { const rr = await req(`${opUrl}/result`, token); return rr.ok ? await rr.json() : body; }
    if (body.status === 'Failed') throw new Error(`LRO failed: ${JSON.stringify(body.error || body)}`);
    wait = 2;
  }
  throw new Error('LRO timed out');
}

(async () => {
  const token = await fabricToken();
  const res = await req(`${REPORT}/getDefinition?format=PBIR`, token, { method: 'POST' });
  const def = await pollLro(res, token);
  const parts = def.definition.parts;
  console.log(`report definition: ${parts.length} parts\n`);

  // resources
  const resources = parts.filter((p) => /StaticResources|RegisteredResources/i.test(p.path));
  console.log('=== resource parts (canvas PNGs live here) ===');
  resources.forEach((p) => console.log('  ' + p.path));
  const pngs = parts.filter((p) => /\.png$/i.test(p.path));
  console.log(`  PNG resources: ${pngs.length}\n`);

  // pages.json
  const pagesMeta = parts.find((p) => /pages\/pages\.json$/i.test(p.path));
  if (pagesMeta) {
    const pj = JSON.parse(b64dec(pagesMeta.payload));
    console.log('=== pages.json ===');
    console.log('  pageOrder:', JSON.stringify(pj.pageOrder));
    console.log('  activePageName:', pj.activePageName, '\n');
  }

  // each page.json: background?
  const pageFiles = parts.filter((p) => /pages\/[^/]+\/page\.json$/i.test(p.path));
  console.log('=== per-page canvas background ===');
  for (const p of pageFiles) {
    const page = JSON.parse(b64dec(p.payload));
    const bg = page.objects && page.objects.background;
    let imgName = null;
    try {
      imgName = bg[0].properties.image.image.name.expr.Literal.Value;
    } catch (_) {}
    console.log(`  ${page.displayName}  [${page.name}]  size=${page.width}x${page.height}`);
    console.log(`      background set: ${!!bg}${imgName ? '  image=' + imgName : ''}`);
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
