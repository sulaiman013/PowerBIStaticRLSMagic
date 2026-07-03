'use strict';
require('dotenv').config();

// ── Power BI target + service principal (all from .env, server-side only) ──
const PBI = {
  tenantId: process.env.TENANT_ID,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  workspaceId: process.env.WORKSPACE_ID,
  reportId: process.env.REPORT_ID,
  datasetId: process.env.DATASET_ID,
  // AAD scope for the Power BI REST API (client-credentials flow).
  scope: 'https://analysis.windows.net/powerbi/api/.default',
  apiRoot: 'https://api.powerbi.com/v1.0/myorg',
};

// ── Portal-only users (NOT Azure AD identities). POC: plaintext is fine. ──
// Each maps to ONE static RLS role that must exist (by exact name) on the model.
const USERS = {
  'a@gmail.com': { password: 'demo123', role: 'Mountain Region' },
  'b@gmail.com': { password: 'demo123', role: 'Pacific Region' },
  'c@gmail.com': { password: 'demo123', role: 'Southwest Region' },
};

// Refresh an embed token this many ms BEFORE it actually expires.
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000; // 5 minutes

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;

function assertConfig() {
  const missing = ['tenantId', 'clientId', 'clientSecret', 'workspaceId', 'reportId', 'datasetId']
    .filter((k) => !PBI[k]);
  if (!SESSION_SECRET || SESSION_SECRET === 'change-me' || SESSION_SECRET.length < 32) {
    missing.push('SESSION_SECRET (long random string; generate with: openssl rand -hex 32)');
  }
  if (missing.length) {
    throw new Error(
      `Missing/invalid .env values: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`
    );
  }
}

module.exports = { PBI, USERS, TOKEN_REFRESH_SKEW_MS, PORT, SESSION_SECRET, assertConfig };
