import { S, CFG } from './state.js';
import { esc, trunc } from './utils.js';

const SOUNDABLE = new Set(['submitted', 'open', 'partial', 'filled', 'cancelled', 'failed']);

function playAlertSound() {
  if (!CFG.notifications) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch (err) {
    console.warn('[NOVA] alert sound skipped:', err.message);
  }
}

function updateBadge() {
  const badge = document.getElementById('notifications-badge');
  if (!badge) return;
  const unread = S.alerts.filter(item => !item.read).length;
  badge.style.display = unread ? 'inline-block' : 'none';
  badge.textContent = unread > 9 ? '9+' : String(unread);
}

export function pushNotification({ title, message, status = 'info' }) {
  const item = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    title,
    message,
    status,
    read: false,
  };
  S.alerts.unshift(item);
  S.alerts = S.alerts.slice(0, 30);
  if (SOUNDABLE.has(status)) playAlertSound();
  updateBadge();
  window.dispatchEvent(new CustomEvent('nova:notificationsUpdated', { detail: item }));
}

export function renderNotificationCenter() {
  const el = document.getElementById('notifications-body');
  if (!el) {
    updateBadge();
    return;
  }

  el.innerHTML = S.alerts.length ? `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:11px;color:var(--text3)">${S.alerts.length} recent update${S.alerts.length !== 1 ? 's' : ''}</div>
      <button class="btn btn-xs btn-ghost" data-testid="notifications-mark-read-button" onclick="Notifications.markAllRead()">Mark all read</button>
    </div>
    ${S.alerts.map((item, index) => `
      <div data-testid="notification-item-${index + 1}" style="padding:10px 12px;border:1px solid var(--border);border-left:3px solid ${item.status === 'failed' ? 'var(--red)' : item.status === 'filled' ? 'var(--green)' : item.status === 'partial' ? 'var(--amber)' : 'var(--blue)'};border-radius:12px;background:var(--surface2);margin-bottom:8px;opacity:${item.read ? '0.75' : '1'}">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
          <div style="font-size:11px;color:var(--text);font-weight:600;flex:1">${esc(trunc(item.title || 'NOVA update', 48))}</div>
          <div style="font-size:10px;color:var(--text3)">${new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;margin-bottom:4px">${esc(item.status)}</div>
        <div style="font-size:11px;color:var(--text2);line-height:1.6">${esc(item.message || '')}</div>
      </div>`).join('')}` : `
    <div class="empty-state" style="padding:24px 10px"><div class="es-text">No notifications yet</div></div>`;

  updateBadge();
}

export function markAllNotificationsRead() {
  S.alerts = S.alerts.map(item => ({ ...item, read: true }));
  renderNotificationCenter();
}

export function toggleNotificationCenter() {
  const modal = document.getElementById('notifications-modal');
  if (!modal) return;
  const open = modal.classList.toggle('open');
  if (open) {
    markAllNotificationsRead();
  }
}

window.Notifications = {
  close() {
    document.getElementById('notifications-modal')?.classList.remove('open');
  },

  closeOnOverlay(event) {
    if (event.target.id === 'notifications-modal') this.close();
  },

  markAllRead() {
    markAllNotificationsRead();
  },
};