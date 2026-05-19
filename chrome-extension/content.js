// CVC Source Verification — Content Script
// Injected into a tab when the background detects a pending review URL.
// Renders the floating verification toolbar.

(function () {
  // Prevent double-injection — clear pending global so it isn't re-used
  if (document.getElementById('cvc-verification-toolbar')) {
    window.__CVC_TOOLBAR_DATA = null;
    return;
  }

  let _suggestion = null;
  let _auth = null;
  let _serverUrl = null;

  // ── Build toolbar ───────────────────────────────────────────────────────────

  function buildToolbar(payload, serverUrl, auth) {
    _suggestion = payload;
    _auth = auth;
    _serverUrl = serverUrl;

    const bar = document.createElement('div');
    bar.id = 'cvc-verification-toolbar';

    bar.innerHTML = `
      <div class="cvc-bar-inner">
        <div class="cvc-bar-left">
          <span class="cvc-logo">⬡ CVC</span>
          <span class="cvc-divider"></span>
          <span class="cvc-company">${esc(payload.company_name)}</span>
          <span class="cvc-divider"></span>
          <span class="cvc-type">${esc(payload.title || payload.suggestion_type.replace(/_/g, ' '))}</span>
          ${payload.snippet ? `<span class="cvc-snippet">${esc(payload.snippet)}</span>` : ''}
        </div>
        <div class="cvc-bar-right">
          <button id="cvc-btn-edit"   class="cvc-btn cvc-btn-edit">Edit</button>
          <button id="cvc-btn-reject" class="cvc-btn cvc-btn-reject">Reject</button>
          <button id="cvc-btn-approve" class="cvc-btn cvc-btn-approve">Approve</button>
          <button id="cvc-btn-close"  class="cvc-btn cvc-btn-close" title="Dismiss">×</button>
        </div>
      </div>
      <div id="cvc-edit-panel" class="cvc-edit-panel" style="display:none">
        <textarea id="cvc-edit-notes" class="cvc-edit-textarea" placeholder="Describe the correction or note..."></textarea>
        <div class="cvc-edit-actions">
          <button id="cvc-btn-edit-submit" class="cvc-btn cvc-btn-approve">Submit Edit</button>
          <button id="cvc-btn-edit-cancel" class="cvc-btn cvc-btn-edit">Cancel</button>
        </div>
      </div>
      <div id="cvc-result-banner" class="cvc-result-banner" style="display:none"></div>
    `;

    document.body.prepend(bar);
    document.body.style.marginTop = '52px';

    // Wire buttons
    bar.querySelector('#cvc-btn-approve').addEventListener('click', () => decide('approved'));
    bar.querySelector('#cvc-btn-reject' ).addEventListener('click', () => decide('rejected'));
    bar.querySelector('#cvc-btn-close'  ).addEventListener('click', dismissToolbar);
    bar.querySelector('#cvc-btn-edit'   ).addEventListener('click', toggleEditPanel);
    bar.querySelector('#cvc-btn-edit-submit').addEventListener('click', submitEdit);
    bar.querySelector('#cvc-btn-edit-cancel').addEventListener('click', toggleEditPanel);
  }

  function esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  function toggleEditPanel() {
    const panel = document.getElementById('cvc-edit-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    document.body.style.marginTop = panel.style.display === 'none' ? '52px' : '120px';
  }

  function submitEdit() {
    const notes = document.getElementById('cvc-edit-notes').value.trim();
    if (!notes) {
      document.getElementById('cvc-edit-notes').style.borderColor = '#ef4444';
      return;
    }
    decide('edited', notes);
  }

  async function decide(decision, editNotes) {
    lockButtons(true);
    showResult('sending', '⏳ Submitting…');

    const response = await chrome.runtime.sendMessage({
      type:          'CVC_DECISION',
      suggestion_id: _suggestion.suggestion_id,
      decision,
      url:           window.location.href,
      edit_notes:    editNotes || null,
    });

    if (response && response.ok) {
      const icons = { approved: '✅', rejected: '❌', edited: '✏️' };
      const labels = { approved: 'Approved', rejected: 'Rejected', edited: 'Edit noted' };
      const colors = { approved: '#10b981', rejected: '#ef4444', edited: '#6366f1' };
      showResult('done', `${icons[decision]} ${labels[decision]} — screenshot saved`, colors[decision]);

      // Auto-dismiss after 3s on approve/reject
      if (decision !== 'edited') {
        setTimeout(dismissToolbar, 3000);
      } else {
        lockButtons(false);
      }
    } else {
      showResult('error', `⚠️ ${(response && response.error) || 'Server error — try again'}`);
      lockButtons(false);
    }
  }

  function lockButtons(locked) {
    ['cvc-btn-approve','cvc-btn-reject','cvc-btn-edit','cvc-btn-edit-submit'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = locked;
    });
  }

  function showResult(state, message, color) {
    const banner = document.getElementById('cvc-result-banner');
    banner.style.display = 'block';
    banner.textContent = message;
    banner.style.background = color || (state === 'error' ? '#7f1d1d' : '#1e3a2f');
  }

  function dismissToolbar() {
    const bar = document.getElementById('cvc-verification-toolbar');
    if (bar) bar.remove();
    document.body.style.marginTop = '';
  }

  // ── Initialize from injected global (primary path, no timing race) ──────────

  const _pending = window.__CVC_TOOLBAR_DATA;
  if (_pending) {
    window.__CVC_TOOLBAR_DATA = null;
    buildToolbar(_pending.payload, _pending.serverUrl, _pending.auth);
  }

  // ── Listen for background messages (fallback) ────────────────────────────────

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CVC_SHOW_TOOLBAR') {
      buildToolbar(message.payload, message.serverUrl, message.auth);
    }
  });

})();
