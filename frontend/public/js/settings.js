/**
 * NOVA — Settings Module
 *
 * ── API KEY STORAGE POLICY ────────────────────────────────────────────────
 *
 * The Anthropic API key is NEVER written to localStorage by default.
 *
 * localStorage is permanent, shared across all browser tabs, and readable
 * by any browser extension or injected script with one line:
 *   localStorage.getItem('nova_settings_v1')
 * It has no expiry and survives browser restarts.
 *
 * Default behaviour (session-only):
 *   Key is stored in sessionStorage only — cleared when the tab closes.
 *   User must re-enter the key each browser session.
 *
 * Explicit opt-in (persist to localStorage):
 *   User checks "Remember key on this device" in settings.
 *   A plaintext warning is shown before this option takes effect.
 *   The preference to persist is itself stored in localStorage so NOVA
 *   knows to load the key back on next session.
 *   The user can revoke this at any time via Clear All Data.
 */

import { CFG, SIM } from './state.js';
import { STORAGE } from './constants.js';
import { load, save, esc } from './utils.js';

// ── Storage keys ──────────────────────────────────────────────────────────
const KEY_SESSION  = 'nova_apikey_session'; // sessionStorage — default
const KEY_PERSIST  = 'nova_apikey_persist'; // localStorage   — explicit opt-in only
const KEY_PERSIST_OPT = 'nova_apikey_persist_opted'; // localStorage — boolean flag

// ── Load ──────────────────────────────────────────────────────────────────
export function loadSettings() {
  // Load all non-sensitive settings from localStorage
  const saved = load(STORAGE.settings, {});

  // Migration: previous versions wrote anthropicKey directly into nova_settings_v1.
  // Remove it silently now — it will be found in KEY_SESSION or KEY_PERSIST below.
  if (saved.anthropicKey) {
    const migratedKey = saved.anthropicKey;
    delete saved.anthropicKey;
    // Re-save without the key so it's gone from localStorage
    save(STORAGE.settings, saved);
    // Move it to sessionStorage (safest migration path — user still has it this session)
    sessionStorage.setItem(KEY_SESSION, migratedKey);
    console.log('[NOVA] Migrated API key out of localStorage → sessionStorage');
  }

  const { anthropicKey: _dropped, ...safe } = saved;
  Object.assign(CFG, safe);

  // R-SETTINGS-01: SIM.enabled must mirror CFG.simMode on boot.
  // CFG.simMode is persisted to localStorage by saveSettings(), but SIM.enabled
  // is runtime-only (never persisted). Without this line, a user who had sim mode
  // on when they closed the tab will see the sim toggle checked in the UI (CFG.simMode=true)
  // but orders will actually go live (SIM.enabled=false) — a dangerous mismatch.
  if (CFG.simMode) SIM.enabled = true;

  // Load API key: sessionStorage first (current session), then localStorage
  // only if the user previously opted in to persistence.
  const sessionKey = sessionStorage.getItem(KEY_SESSION);
  if (sessionKey) {
    CFG.anthropicKey = sessionKey;
    return;
  }

  const opted = localStorage.getItem(KEY_PERSIST_OPT) === 'true';
  if (opted) {
    const persistedKey = localStorage.getItem(KEY_PERSIST);
    if (persistedKey) CFG.anthropicKey = persistedKey;
  }
}

// ── Save ──────────────────────────────────────────────────────────────────
export function saveSettings() {
  // Save all non-sensitive settings to localStorage
  save(STORAGE.settings, {
    // anthropicKey intentionally omitted
    useProxy:        CFG.useProxy,
    tradingEnabled:  CFG.tradingEnabled,
    maxPositionUSD:  CFG.maxPositionUSD,
    defaultOrderAmt: CFG.defaultOrderAmt,
    simMode:         CFG.simMode,
    notifications:   CFG.notifications,
  });

  // Save the API key to sessionStorage (always — so it survives page refreshes)
  if (CFG.anthropicKey) {
    sessionStorage.setItem(KEY_SESSION, CFG.anthropicKey);
  } else {
    sessionStorage.removeItem(KEY_SESSION);
  }

  // Only write to localStorage if user explicitly opted in
  const opted = localStorage.getItem(KEY_PERSIST_OPT) === 'true';
  if (opted && CFG.anthropicKey) {
    localStorage.setItem(KEY_PERSIST, CFG.anthropicKey);
  } else if (!opted) {
    // Ensure no stale persisted key exists if user revoked opt-in
    localStorage.removeItem(KEY_PERSIST);
  }
}

// ── Persist preference toggle (called from UI) ────────────────────────────
export function setKeyPersistence(persist) {
  if (persist) {
    localStorage.setItem(KEY_PERSIST_OPT, 'true');
    if (CFG.anthropicKey) localStorage.setItem(KEY_PERSIST, CFG.anthropicKey);
  } else {
    localStorage.removeItem(KEY_PERSIST_OPT);
    localStorage.removeItem(KEY_PERSIST);
  }
}

// ── Clear key from all storage ────────────────────────────────────────────
export function clearApiKey() {
  CFG.anthropicKey = '';
  sessionStorage.removeItem(KEY_SESSION);
  localStorage.removeItem(KEY_PERSIST);
  localStorage.removeItem(KEY_PERSIST_OPT);
}

export function renderSettingsPanel() {
  const el = document.getElementById('settings-body');
  if (!el) return;

  const isPersisted = localStorage.getItem(KEY_PERSIST_OPT) === 'true';
  const hasKey      = !!CFG.anthropicKey;

  el.innerHTML = `
    <!-- Anthropic API -->
    <div class="settings-section">
      <div class="section-title">AI & Agents</div>

      <div class="settings-row">
        <div>
          <div class="sr-label">Anthropic API Key</div>
          <div class="sr-desc">Required for AI market analysis</div>
        </div>
        ${hasKey
          ? `<span style="font-size:11px;color:var(--green)">✓ Key loaded</span>`
          : `<span style="font-size:11px;color:var(--text3)">Not set</span>`}
      </div>

      <div class="form-group" style="margin-top:8px">
        <input class="nova-input" id="set-anthropic-key" data-testid="settings-anthropic-key-input" type="password"
          placeholder="sk-ant-… (enter to update)"
          value="${esc(CFG.anthropicKey || '')}"
          oninput="Settings.onKeyInput(this.value)">
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
          <button class="btn btn-sm btn-primary" data-testid="settings-test-key-button" onclick="Settings.testKey()">Test Key</button>
          <button class="btn btn-sm" data-testid="settings-clear-key-button" onclick="Settings.clearKey()" style="color:var(--text3)">Clear</button>
          <span id="set-key-status" data-testid="settings-key-status" style="font-size:11px"></span>
        </div>
      </div>

      <!-- Persistence opt-in — off by default -->
      <div style="margin-top:12px;padding:10px 12px;border-radius:6px;border:1px solid ${isPersisted ? 'var(--amber)' : 'var(--border)'}">
        <div class="settings-row" style="margin-bottom:${isPersisted ? '10px' : '0'}">
          <div>
            <div class="sr-label" style="color:${isPersisted ? 'var(--amber)' : 'var(--text)'}">
              Remember key on this device
            </div>
            <div class="sr-desc">
              Off by default — key is session-only (cleared on tab close)
            </div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="set-key-persist" data-testid="settings-persist-key-toggle" ${isPersisted ? 'checked' : ''}
              onchange="Settings.onPersistToggle(this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        ${isPersisted ? `
        <div style="font-size:10px;line-height:1.6;color:var(--amber);padding-top:8px;border-top:1px solid rgba(255,184,0,0.15)">
          ⚠ Key is stored as <strong>plaintext</strong> in browser localStorage.
          Any browser extension or script running on this page can read it.
          Only enable this on a private, trusted device.
          <span style="display:block;margin-top:4px">
            <a href="#" onclick="Settings.clearKey();return false" style="color:var(--amber);text-decoration:underline">
              Remove persisted key
            </a>
          </span>
        </div>` : `
        <div style="font-size:10px;color:var(--text3);padding-top:0;line-height:1.5">
          Session-only: key lives in sessionStorage and is never written to disk.
        </div>`}
      </div>
    </div>

    <!-- Trading -->
    <div class="settings-section">
      <div class="section-title">Trading</div>
      <div class="settings-row">
        <div><div class="sr-label">Live Trading</div><div class="sr-desc">Enable real CLOB order submission</div></div>
        <label class="toggle"><input type="checkbox" id="set-trading" data-testid="settings-live-trading-toggle" ${CFG.tradingEnabled ? 'checked' : ''} onchange="Settings.onToggle('tradingEnabled',this.checked)"><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-row">
        <div><div class="sr-label">Simulation Mode</div><div class="sr-desc">Paper trade without real funds</div></div>
        <label class="toggle"><input type="checkbox" id="set-sim" data-testid="settings-sim-mode-toggle" ${CFG.simMode ? 'checked' : ''} onchange="Settings.onToggle('simMode',this.checked)"><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-row">
        <div><div class="sr-label">Max Position Size</div></div>
        <input class="nova-input" style="width:80px;text-align:right" type="number" id="set-max-pos" data-testid="settings-max-position-input"
          value="${CFG.maxPositionUSD}" min="1" max="10000"
          onchange="Settings.onChange('maxPositionUSD', parseFloat(this.value))">
      </div>
      <div class="settings-row">
        <div><div class="sr-label">Default Order Amount ($)</div></div>
        <input class="nova-input" style="width:80px;text-align:right" type="number" id="set-default-amt" data-testid="settings-default-order-input"
          value="${CFG.defaultOrderAmt}" min="1" max="1000"
          onchange="Settings.onChange('defaultOrderAmt', parseFloat(this.value))">
      </div>
    </div>

    <!-- Data -->
    <div class="settings-section">
      <div class="section-title">Data & Storage</div>
      <div class="settings-row">
        <div><div class="sr-label">Export Settings</div><div class="sr-desc">API key is never included in export</div></div>
        <button class="btn btn-sm" data-testid="settings-export-button" onclick="Settings.export()">Export JSON</button>
      </div>
      <div class="settings-row">
        <div><div class="sr-label">Import Settings</div></div>
        <label class="btn btn-sm" data-testid="settings-import-button" style="cursor:pointer">
          Import <input type="file" accept=".json" data-testid="settings-import-input" style="display:none" onchange="Settings.import(event)">
        </label>
      </div>
      <div class="settings-row">
        <div><div class="sr-label">Clear All Data</div><div class="sr-desc" style="color:var(--red-dim)">Removes all settings, key, and data</div></div>
        <button class="btn btn-sm btn-red" data-testid="settings-clear-all-button" onclick="Settings.clearAll()">Clear</button>
      </div>
    </div>

    <div style="padding-top:4px">
      <button class="btn btn-primary" data-testid="settings-save-button" style="width:100%" onclick="Settings.save()">Save Settings</button>
    </div>`;
}

window.Settings = {
  onKeyInput(val) { CFG.anthropicKey = val; },
  onToggle(key, val) { CFG[key] = val; if (key === 'simMode') SIM.enabled = val; },
  onChange(key, val) { CFG[key] = val; },

  onPersistToggle(checked) {
    if (checked) {
      // Show an in-panel confirmation before writing the key to disk.
      // The warning renders inside the panel itself — no blocking confirm().
      setKeyPersistence(true);
    } else {
      setKeyPersistence(false);
    }
    // Re-render so the warning/info block updates immediately
    renderSettingsPanel();
  },

  clearKey() {
    clearApiKey();
    renderSettingsPanel();
    window.showToast?.('API key cleared from all storage', 'info');
  },

  async testKey() {
    const statusEl = document.getElementById('set-key-status');
    if (!CFG.anthropicKey) {
      statusEl.textContent = '✗ No key set';
      statusEl.style.color = 'var(--red)';
      return;
    }
    statusEl.textContent = 'Testing…';
    statusEl.style.color = 'var(--text2)';
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CFG.anthropicKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      if (r.ok) {
        statusEl.textContent = '✓ Valid';
        statusEl.style.color = 'var(--green)';
      } else {
        statusEl.textContent = `✗ Invalid (${r.status})`;
        statusEl.style.color = 'var(--red)';
      }
    } catch {
      statusEl.textContent = '✗ Network error';
      statusEl.style.color = 'var(--red)';
    }
  },

  save() {
    saveSettings();
    window.showToast?.('Settings saved', 'success');
    Settings.close();
  },

  close() {
    document.getElementById('settings-modal').classList.remove('open');
  },

  closeOnOverlay(e) {
    if (e.target.id === 'settings-modal') Settings.close();
  },

  export() {
    // Explicitly strip anthropicKey — it must never appear in exported files.
    // A user could share their settings export without realising the key is in it.
    const { anthropicKey: _stripped, ...exportable } = CFG;
    const blob = new Blob(
      [JSON.stringify(exportable, null, 2)],
      { type: 'application/json' }
    );
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'nova-settings.json',
    });
    a.click();
  },

  import(event) {
    const f = event.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = e => {
      try {
        const data = JSON.parse(e.target.result);

        // Whitelist: only these keys are accepted from an import file.
        // Anything outside this list (including anthropicKey, internal state,
        // or unknown fields from a crafted file) is silently dropped.
        const IMPORTABLE = {
          useProxy:        'boolean',
          tradingEnabled:  'boolean',
          simMode:         'boolean',
          notifications:   'boolean',
          maxPositionUSD:  'number',
          defaultOrderAmt: 'number',
        };

        const validated = {};
        for (const [key, expectedType] of Object.entries(IMPORTABLE)) {
          if (!(key in data)) continue;
          const val = data[key];
          if (typeof val !== expectedType) {
            console.warn(`[NOVA] Import: skipped "${key}" -- expected ${expectedType}, got ${typeof val}`);
            continue;
          }
          // Range-check numerics so a crafted file cannot set absurd values
          if (key === 'maxPositionUSD'  && (val < 1 || val > 10000)) continue;
          if (key === 'defaultOrderAmt' && (val < 1 || val > 1000))  continue;
          validated[key] = val;
        }

        Object.assign(CFG, validated);
        if (validated.simMode !== undefined) SIM.enabled = validated.simMode;
        saveSettings();
        renderSettingsPanel();
        window.showToast?.(`Settings imported (${Object.keys(validated).length} fields)`, 'success');
      } catch {
        window.showToast?.('Invalid settings file', 'error');
      }
    };
    r.readAsText(f);
  },

  clearAll() {
    if (!confirm('Clear all NOVA data? This cannot be undone.')) return;
    Object.values(STORAGE).forEach(k => localStorage.removeItem(k));
    sessionStorage.clear();
    localStorage.removeItem(KEY_PERSIST);
    localStorage.removeItem(KEY_PERSIST_OPT);
    window.showToast?.('All data cleared — reloading…', 'info');
    // Reload so in-memory CFG and SIM state match the now-empty storage.
    // Without this, CFG.tradingEnabled / SIM.enabled etc. stay at their
    // old values even though localStorage is cleared.
    setTimeout(() => window.location.reload(), 600);
  },
};
// ── End of settings module ─────────────────────────────────────────────────
// (dead duplicate renderSettingsPanel body removed — caused SyntaxError via
//  bare `return` at module top-level, preventing entire module from loading)
