const API = (window.WALLPAPER_API_BASE || '').replace(/\/+$/, '');
const TOKEN_KEY = 'xlonely-wallpaper-session';
const token = localStorage.getItem(TOKEN_KEY);
const list = document.querySelector('#admin-list');
const message = document.querySelector('#admin-message');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(path, options = {}) {
  return fetch(`${API}${path}`, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
}

async function loadQueue() {
  if (!API || !token) {
    message.textContent = 'Configure the community Worker and sign in from the gallery first.';
    return;
  }
  const response = await api('/api/admin/submissions');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    message.textContent = body.error || 'Moderator access required. Sign in with the configured moderator GitHub account.';
    return;
  }
  const rows = await response.json();
  message.textContent = rows.length ? `${rows.length} pending submission${rows.length === 1 ? '' : 's'}` : 'The review queue is empty.';
  list.innerHTML = rows.map(row => `<article class="review-card" data-id="${esc(row.id)}"><div class="review-media" data-media></div><div class="review-details"><span class="viewer-kind">${esc(row.kind)} · ${esc(row.format)}</span><h2>${esc(row.title)}</h2><p>Submitted by <strong>${esc(row.github_login)}</strong> · ${(Number(row.size)/1048576).toFixed(1)} MB</p><p>${esc(row.creator || 'Creator not provided')}${row.source_url ? ` · <a href="${esc(row.source_url)}" target="_blank" rel="noreferrer">Source ↗</a>` : ''}</p><p>Colors: ${esc((row.colors || []).join(', ') || 'none')}</p><div class="review-actions"><button data-decision="approve">Approve</button><button data-decision="reject">Reject & delete</button></div></div></article>`).join('');
  for (const card of list.querySelectorAll('.review-card')) {
    const row = rows.find(item => item.id === card.dataset.id);
    const media = card.querySelector('[data-media]');
    try {
      const previewResponse = row.previewUrl ? await api(`/api/admin/submissions/${encodeURIComponent(row.id)}/preview`) : null;
      const fileResponse = previewResponse?.ok ? previewResponse : await api(`/api/admin/submissions/${encodeURIComponent(row.id)}/file`);
      if (fileResponse.ok) {
        const blob = await fileResponse.blob();
        const objectUrl = URL.createObjectURL(blob);
        if (!row.previewUrl && row.kind === 'live' && ['MP4','WEBM','MOV'].includes(row.format)) {
          const video = document.createElement('video'); video.src = objectUrl; video.controls = true; video.preload = 'metadata'; media.append(video);
        } else {
          const image = document.createElement('img'); image.src = objectUrl; image.alt = row.title; media.append(image);
        }
      }
    } catch {}
    card.querySelectorAll('[data-decision]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      const result = await api('/api/admin/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: row.id, decision: button.dataset.decision }) });
      if (!result.ok) {
        const body = await result.json().catch(() => ({}));
        message.textContent = body.error || 'Review action failed.';
        button.disabled = false;
        return;
      }
      card.remove();
      message.textContent = `${row.title} ${button.dataset.decision === 'approve' ? 'approved' : 'rejected and deleted'}.`;
      if (!list.children.length) message.textContent += ' The queue is empty.';
    }));
  }
}

loadQueue().catch(() => { message.textContent = 'Could not connect to the community service.'; });
