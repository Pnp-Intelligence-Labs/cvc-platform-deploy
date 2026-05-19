// CVC Source Verification — Background Service Worker
// Watches tab URL changes, checks if the URL matches a pending review,
// and injects the verification toolbar when it does.

const POLL_INTERVAL_MS = 2500;
let pollTimer = null;
let lastCheckedUrl = null;
let lastTabId = null;

// ── Config helpers ────────────────────────────────────────────────────────────

async function getConfig() {
  const data = await chrome.storage.local.get(['serverUrl', 'username', 'password', 'jwtToken']);
  return {
    serverUrl: (data.serverUrl || '').replace(/\/$/, ''),
    username:  data.username  || '',
    password:  data.password  || '',
    jwtToken:  data.jwtToken  || '',
  };
}

async function getAuthHeader() {
  const cfg = await getConfig();
  if (cfg.jwtToken) return `Bearer ${cfg.jwtToken}`;
  return '';
}

// Re-login and store new token. Returns true on success.
async function refreshToken() {
  const cfg = await getConfig();
  if (!cfg.username || !cfg.password || !cfg.serverUrl) return false;
  try {
    const res = await fetch(`${cfg.serverUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    await chrome.storage.local.set({ jwtToken: data.access_token });
    return true;
  } catch {
    return false;
  }
}

// Fetch with automatic token refresh on 401.
async function apiFetch(url, options = {}) {
  const auth = await getAuthHeader();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: auth },
  });
  if (res.status === 401) {
    const ok = await refreshToken();
    if (!ok) return res;
    const newAuth = await getAuthHeader();
    return fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: newAuth },
    });
  }
  return res;
}

// ── Core: check if current tab URL matches a pending review ───────────────────

async function checkTabUrl(tabId, url) {
  if (!url || url.startsWith('chrome') || url.startsWith('about')) return;

  const cfg = await getConfig();
  if (!cfg.serverUrl || !cfg.jwtToken) return;

  try {
    const res = await apiFetch(
      `${cfg.serverUrl}/review/match?url=${encodeURIComponent(url)}`
    );
    if (!res.ok) return;

    const data = await res.json();
    if (!data || !data.suggestion_id) return;

    const auth = await getAuthHeader();

    // Inject CSS first, then stamp data into the page as a global,
    // then inject content.js which reads it immediately — no message-passing race.
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content.css'],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (payload, serverUrl, authHeader) => {
        window.__CVC_TOOLBAR_DATA = { payload, serverUrl, auth: authHeader };
      },
      args: [data, cfg.serverUrl, auth],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });

  } catch (e) {
    // Server unreachable — silently skip
  }
}

// ── Tab event listeners ───────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    checkTabUrl(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url) checkTabUrl(tabId, tab.url);
});

// ── Handle decision messages from content script ──────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CVC_DECISION') {
    handleDecision(message, sender.tab?.id).then(sendResponse);
    return true; // keep channel open for async response
  }
});

async function handleDecision(message, tabId) {
  const cfg = await getConfig();
  try {
    const res = await apiFetch(`${cfg.serverUrl}/review/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suggestion_id: message.suggestion_id,
        decision:      message.decision,
        url:           message.url,
        edit_notes:    message.edit_notes || null,
      }),
    });
    const data = await res.json();
    return { ok: res.ok, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
