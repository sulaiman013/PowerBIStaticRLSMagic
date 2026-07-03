'use strict';

// powerbi-client global namespace + service instance
const pbiClient = window['powerbi-client'];
const models = pbiClient.models;
const powerbi = window.powerbi; // service instance created by the library

const container = document.getElementById('report-container');
const statusEl = document.getElementById('status');
let reportRef = null;

function setStatus(text, fatal) {
  container.innerHTML = `<div class="${fatal ? 'fatal' : 'loading'}">${text}</div>`;
}

async function getEmbedConfig() {
  const res = await fetch('/api/embed-config');
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('redirecting to login');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to get embed config');
  }
  return res.json();
}

async function refreshUsage() {
  try {
    const res = await fetch('/api/token-usage');
    if (!res.ok) return;
    const u = await res.json();
    const usageChip = document.getElementById('usage-chip');
    if (u.percentage != null) {
      usageChip.textContent = `trial used: ${u.percentage}%`;
    } else if (u.embedTrial && u.embedTrial.state) {
      usageChip.textContent = `trial: ${u.embedTrial.state}`;
    } else {
      usageChip.textContent = 'trial: n/a';
    }
    document.getElementById('token-chip').textContent = `tokens burned: ${u.generateTokenCount}`;
  } catch (_) {
    /* non-fatal */
  }
}

async function embedReport() {
  // header identity
  try {
    const me = await fetch('/api/me');
    if (me.status === 401) { window.location.href = '/login.html'; return; }
    const user = await me.json();
    document.getElementById('user-email').textContent = user.email;
    document.getElementById('role-chip').textContent = `role: ${user.role}`;
  } catch (_) { /* handled below */ }

  let cfg;
  try {
    cfg = await getEmbedConfig();
  } catch (e) {
    if (e.message !== 'redirecting to login') setStatus('Could not load report: ' + e.message, true);
    return;
  }

  // fresh container for the embed
  container.innerHTML = '';

  const embedConfig = {
    type: 'report',
    id: cfg.reportId,
    embedUrl: cfg.embedUrl,
    accessToken: cfg.embedToken,
    tokenType: models.TokenType.Embed, // app-owns-data
    settings: {
      panes: { filters: { visible: false }, pageNavigation: { visible: true } },
      // Keep the report's own background (the canvas design). Transparent would
      // drop the page canvas background and show the host page behind it.
      background: models.BackgroundType.Default,
    },
  };

  reportRef = powerbi.embed(container, embedConfig);

  reportRef.off('loaded');
  reportRef.on('loaded', () => refreshUsage());

  reportRef.off('error');
  reportRef.on('error', (evt) => {
    console.error('Power BI embed error', evt.detail);
  });

  // App-owns-data token refresh: when the embed token nears expiry, get a new one.
  reportRef.off('tokenExpired');
  reportRef.on('tokenExpired', async () => {
    try {
      const fresh = await getEmbedConfig();
      await reportRef.setAccessToken(fresh.embedToken);
      refreshUsage();
    } catch (e) {
      setStatus('Session token expired and refresh failed. Please log in again.', true);
    }
  });
}

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

embedReport();
