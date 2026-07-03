'use strict';
/*
 * Admin utility: add 3 static RLS roles to the PUBLISHED semantic model in place,
 * via the Fabric getDefinition/updateDefinition APIs. Additive and idempotent:
 * it pulls the current published TMDL, adds only the role parts (+ ref role lines
 * in model.tmdl), and pushes the full definition back. Tables, partitions and the
 * already-imported data are left exactly as they are (roles are pure metadata).
 *
 * Usage:
 *   node add-rls-roles.js          # DRY RUN: inspect + show what would change
 *   node add-rls-roles.js --apply  # actually update the published model
 */
require('dotenv').config();
const { PBI } = require('./config');
const msal = require('@azure/msal-node');

const APPLY = process.argv.includes('--apply');
const FABRIC = 'https://api.fabric.microsoft.com/v1';
const MODEL = `${FABRIC}/workspaces/${PBI.workspaceId}/semanticModels/${PBI.datasetId}`;

const ROLES = [
  { name: 'Mountain Region', region: 'Mountain' },
  { name: 'Pacific Region', region: 'Pacific' },
  { name: 'Southwest Region', region: 'Southwest' },
];
const roleTmdl = (r) =>
  `role '${r.name}'\n\tmodelPermission: read\n\n\ttablePermission dim_store =\n\t\t\tdim_store[Region] = "${r.region}"\n`;

const b64enc = (s) => Buffer.from(s, 'utf8').toString('base64');
const b64dec = (s) => Buffer.from(s, 'base64').toString('utf8');

async function fabricToken() {
  const cca = new msal.ConfidentialClientApplication({
    auth: {
      clientId: PBI.clientId,
      authority: `https://login.microsoftonline.com/${PBI.tenantId}`,
      clientSecret: PBI.clientSecret,
    },
  });
  const r = await cca.acquireTokenByClientCredential({ scopes: ['https://api.fabric.microsoft.com/.default'] });
  return r.accessToken;
}

async function req(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  return res;
}

// Handle Fabric long-running operations. Returns final JSON body (or result body).
async function pollLro(res, token) {
  if (res.status !== 202) {
    const t = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${t}`);
    return t ? JSON.parse(t) : {};
  }
  const opUrl = res.headers.get('Location');
  let wait = parseInt(res.headers.get('Retry-After') || '2', 10);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    const s = await req(opUrl, token);
    const body = await s.json().catch(() => ({}));
    if (body.status === 'Succeeded') {
      const resultRes = await req(`${opUrl}/result`, token);
      if (resultRes.ok) return await resultRes.json().catch(() => ({}));
      return body;
    }
    if (body.status === 'Failed') throw new Error(`LRO failed: ${JSON.stringify(body.error || body)}`);
    wait = 2;
  }
  throw new Error('LRO timed out');
}

(async () => {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  const token = await fabricToken();

  console.log('getDefinition...');
  const getRes = await req(`${MODEL}/getDefinition?format=TMDL`, token, { method: 'POST' });
  const def = await pollLro(getRes, token);
  const parts = def.definition.parts;
  console.log(`  current definition has ${parts.length} parts`);

  const modelPart = parts.find((p) => p.path === 'definition/model.tmdl');
  if (!modelPart) throw new Error('model.tmdl not found in definition');
  let modelText = b64dec(modelPart.payload);

  const existingRoles = parts.filter((p) => p.path.startsWith('definition/roles/')).map((p) => p.path);
  console.log(`  existing role parts: ${existingRoles.length ? existingRoles.join(', ') : '(none)'}`);

  // Add role parts that are missing
  let added = 0;
  for (const r of ROLES) {
    const path = `definition/roles/${r.name}.tmdl`;
    if (!parts.find((p) => p.path === path)) {
      parts.push({ path, payload: b64enc(roleTmdl(r)), payloadType: 'InlineBase64' });
      added++;
    }
    const refLine = `ref role '${r.name}'`;
    if (!modelText.includes(refLine)) {
      // insert ref role lines before "ref cultureInfo"
      if (modelText.includes('ref cultureInfo')) {
        modelText = modelText.replace(/(\nref cultureInfo)/, `\n${refLine}$1`);
      } else {
        modelText = modelText.trimEnd() + `\n${refLine}\n`;
      }
    }
  }
  modelPart.payload = b64enc(modelText);

  console.log(`  role parts to add: ${added}`);
  console.log('  --- model.tmdl (after) tail ---');
  console.log(modelText.split('\n').slice(-12).map((l) => '    ' + l).join('\n'));

  if (!APPLY) {
    console.log('\nDRY RUN complete. Re-run with --apply to update the published model.');
    return;
  }

  console.log('\nupdateDefinition...');
  const upRes = await req(`${MODEL}/updateDefinition`, token, {
    method: 'POST',
    body: JSON.stringify({ definition: { parts } }),
  });
  await pollLro(upRes, token);
  console.log('  updateDefinition succeeded.');

  // Verify RLS is now present (Power BI REST)
  const pbiTok = await (async () => {
    const cca = new msal.ConfidentialClientApplication({
      auth: { clientId: PBI.clientId, authority: `https://login.microsoftonline.com/${PBI.tenantId}`, clientSecret: PBI.clientSecret },
    });
    return (await cca.acquireTokenByClientCredential({ scopes: [PBI.scope] })).accessToken;
  })();
  const d = await (await req(`${PBI.apiRoot}/groups/${PBI.workspaceId}/datasets/${PBI.datasetId}`, pbiTok)).json();
  console.log(`\nVERIFY: isEffectiveIdentityRequired = ${d.isEffectiveIdentityRequired} (expect true)`);
  console.log('Done.');
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
