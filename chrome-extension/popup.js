// Load saved settings on open
chrome.storage.local.get(['serverUrl', 'username', 'password', 'jwtToken'], data => {
  if (data.serverUrl) document.getElementById('serverUrl').value = data.serverUrl;
  if (data.username)  document.getElementById('username').value  = data.username;
  if (data.password)  document.getElementById('password').value  = data.password;

  const status = document.getElementById('status');
  if (data.jwtToken) {
    status.textContent = '✓ Logged in — JWT active';
    status.className = 'status ok';
  }
});

document.getElementById('btnTest').addEventListener('click', async () => {
  const status = document.getElementById('status');
  const debug  = document.getElementById('debug');

  const data = await chrome.storage.local.get(['serverUrl', 'jwtToken']);
  const serverUrl = data.serverUrl || '';
  const token = data.jwtToken || '';

  if (!serverUrl || !token) {
    status.textContent = 'Save settings first.';
    status.className = 'status err';
    return;
  }

  // Get current tab URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  status.textContent = 'Checking…';
  status.className = 'status';
  debug.style.display = 'block';
  debug.textContent = `URL: ${url}`;

  if (!url || url.startsWith('chrome') || url.startsWith('about')) {
    status.textContent = 'No valid tab URL';
    status.className = 'status err';
    return;
  }

  try {
    const res = await fetch(
      `${serverUrl}/review/match?url=${encodeURIComponent(url)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const text = await res.text();
    debug.textContent = `URL: ${url}\n\nHTTP ${res.status}\n${text.slice(0, 300)}`;
    if (res.ok) {
      status.textContent = '✓ Match found — toolbar should appear';
      status.className = 'status ok';
    } else if (res.status === 404) {
      status.textContent = 'No pending review for this URL';
      status.className = 'status err';
    } else if (res.status === 401) {
      status.textContent = 'Token expired — click Save to re-login';
      status.className = 'status err';
    } else {
      status.textContent = `Server error: HTTP ${res.status}`;
      status.className = 'status err';
    }
  } catch (e) {
    status.textContent = `Network error: ${e.message}`;
    status.className = 'status err';
    debug.textContent = `URL: ${url}\n\nError: ${e.message}\n\nIs the server reachable? Try:\n${serverUrl}/health`;
  }
});

document.getElementById('btnSave').addEventListener('click', async () => {
  const serverUrl = document.getElementById('serverUrl').value.trim().replace(/\/$/, '');
  const username  = document.getElementById('username').value.trim();
  const password  = document.getElementById('password').value;
  const status    = document.getElementById('status');

  if (!serverUrl || !username || !password) {
    status.textContent = 'All fields required.';
    status.className = 'status err';
    return;
  }

  status.textContent = 'Logging in…';
  status.className = 'status';

  try {
    const res = await fetch(`${serverUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const text = await res.text();
      status.textContent = `Login failed: ${res.status} — ${text.slice(0, 80)}`;
      status.className = 'status err';
      return;
    }
    const data = await res.json();
    await chrome.storage.local.set({ serverUrl, username, password, jwtToken: data.access_token });
    status.textContent = `✓ Logged in as ${data.username} (${data.role})`;
    status.className = 'status ok';
  } catch (e) {
    status.textContent = `Connection failed: ${e.message}`;
    status.className = 'status err';
  }
});
