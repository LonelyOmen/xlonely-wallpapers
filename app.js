const COLORS = [
  ['red', '#ef5350'], ['orange', '#ff9f43'], ['yellow', '#f8d44e'],
  ['green', '#53b66d'], ['blue', '#4e9ee9'], ['purple', '#9b72cf'],
  ['pink', '#e868a2'], ['white', '#f3f0f5'], ['black', '#24222b']
];
const API_BASE = (window.WALLPAPER_API_BASE || '').replace(/\/+$/, '');
const TOKEN_KEY = 'xlonely-wallpaper-session';
const MAX_UPLOAD_BYTES = 99_000_000;
const state = { items: [], collection: 'personal', kind: 'all', color: null, sourceCategory: null, visibleCount: 120, query: '' };
const $ = (selector) => document.querySelector(selector);
const grid = $('#wallpaper-grid');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url = (path) => path.split('/').map(encodeURIComponent).join('/');
const rawAssetUrl = (path) => `https://raw.githubusercontent.com/LonelyOmen/xlonely-wallpapers/main/${url(path)}`;
const githubDownloadUrl = (path) => `https://github.com/LonelyOmen/xlonely-wallpapers/raw/refs/heads/main/${url(path)}?download=1`;
const assetUrl = (item) => item.assetUrl || (/^https?:\/\//i.test(item.file || '') ? item.file : rawAssetUrl(item.file));
const downloadUrl = (item) => item.downloadUrl || (item.assetUrl ? `${item.assetUrl}?download=1` : githubDownloadUrl(item.file));
const previewUrl = (item) => item.previewUrl || url(item.preview || '');
const REPO_SOURCE = { owner: 'CantonyEddy', repo: 'MyWallpaper', url: 'https://github.com/CantonyEddy/MyWallpaper' };
const SOURCE_CACHE_KEY = 'xlonely-cantony-wallpapers-v1';
const SOURCE_CACHE_TTL = 60 * 60 * 1000;
const PAGE_SIZE = 120;

function externalPath(path) { return path.split('/').map(encodeURIComponent).join('/'); }

function sourceCategoryFor(path) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return 'Unsorted';
  const first = parts[0].toLocaleLowerCase();
  if (['assets', 'wallpaper', 'wallpapers', 'image', 'images', 'static', 'live'].includes(first)) {
    return parts.length > 2 ? parts[1] : 'Unsorted';
  }
  return parts[0];
}

function prettyCategory(value) {
  return String(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

async function loadCantonyCollection() {
  try {
    const cached = JSON.parse(localStorage.getItem(SOURCE_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.savedAt < SOURCE_CACHE_TTL && Array.isArray(cached.items)) return cached;
  } catch {}

  const headers = { accept: 'application/vnd.github+json' };
  const repoResponse = await fetch(`https://api.github.com/repos/${REPO_SOURCE.owner}/${REPO_SOURCE.repo}`, { headers });
  if (!repoResponse.ok) throw new Error(`GitHub repository lookup returned ${repoResponse.status}.`);
  const repo = await repoResponse.json();
  const branch = repo.default_branch || 'main';
  const treeResponse = await fetch(`https://api.github.com/repos/${REPO_SOURCE.owner}/${REPO_SOURCE.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers });
  if (!treeResponse.ok) throw new Error(`GitHub file list returned ${treeResponse.status}.`);
  const tree = await treeResponse.json();
  if (!Array.isArray(tree.tree)) throw new Error('GitHub returned an unexpected file list.');

  const imageExts = new Set(['jpg','jpeg','png','webp','gif','bmp','avif']);
  const videoExts = new Set(['mp4','webm','mov','mkv','avi']);
  const items = tree.tree.filter(entry => entry.type === 'blob').flatMap(entry => {
    const ext = entry.path.split('.').pop().toLowerCase();
    if (!imageExts.has(ext) && !videoExts.has(ext)) return [];
    const path = externalPath(entry.path);
    const raw = `https://raw.githubusercontent.com/${REPO_SOURCE.owner}/${REPO_SOURCE.repo}/${encodeURIComponent(branch)}/${path}`;
    const download = `https://github.com/${REPO_SOURCE.owner}/${REPO_SOURCE.repo}/raw/refs/heads/${encodeURIComponent(branch)}/${path}?download=1`;
    const category = sourceCategoryFor(entry.path);
    return [{
      name: entry.path.split('/').pop().replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
      file: raw,
      assetUrl: raw,
      downloadUrl: download,
      previewUrl: imageExts.has(ext) ? raw : null,
      kind: videoExts.has(ext) || ext === 'gif' ? 'live' : 'still',
      format: ext.toUpperCase(),
      resolution: null,
      fps: null,
      colors: [],
      bytes: Number(entry.size) || 0,
      collection: 'cantony',
      creditName: REPO_SOURCE.owner,
      creditUrl: REPO_SOURCE.url,
      sourceCategory: category,
    }];
  });
  const result = { savedAt: Date.now(), items, truncated: Boolean(tree.truncated) };
  try { localStorage.setItem(SOURCE_CACHE_KEY, JSON.stringify(result)); } catch {}
  return result;
}

function setupColors() {
  const root = $('#color-filters');
  COLORS.forEach(([name, color]) => {
    const button = document.createElement('button');
    button.className = 'color-filter'; button.dataset.color = name; button.title = `Filter ${name}`;
    button.setAttribute('aria-label', `Filter ${name}`); button.setAttribute('aria-pressed', 'false'); button.style.backgroundColor = color;
    button.addEventListener('click', () => { state.color = state.color === name ? null : name; render(); });
    root.append(button);
  });
}

function filteredItems() {
  const q = state.query.trim().toLocaleLowerCase();
  return state.items.filter(item =>
    (state.collection === 'all' || (item.collection || 'personal') === state.collection) &&
    (state.kind === 'all' || item.kind === state.kind) &&
    (state.collection !== 'cantony' || !state.sourceCategory || item.sourceCategory === state.sourceCategory) &&
    (!state.color || (item.colors || []).includes(state.color)) &&
    (!q || `${item.name} ${item.format} ${item.kind} ${item.submitter || ''} ${item.creditName || ''} ${item.sourceCategory || ''} ${(item.colors || []).join(' ')}`.toLocaleLowerCase().includes(q))
  );
}

function render() {
  document.querySelectorAll('.collection-tab').forEach(button => {
    const active = button.dataset.collection === state.collection;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.type-tab').forEach(button => {
    const active = button.dataset.kind === state.kind;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.color-filter').forEach(button => {
    const active = button.dataset.color === state.color;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  const categoryBar = $('#source-category-bar');
  const categoryRoot = $('#source-category-filters');
  const categories = [...new Set(state.items.filter(item => item.collection === 'cantony').map(item => item.sourceCategory || 'Unsorted'))].sort((a, b) => a.localeCompare(b));
  categoryBar.classList.toggle('hidden', state.collection !== 'cantony' || categories.length === 0);
  if (state.sourceCategory && !categories.includes(state.sourceCategory)) state.sourceCategory = null;
  categoryRoot.innerHTML = `<button class="source-category-tab${state.sourceCategory === null ? ' active' : ''}" data-category="">All categories</button>` + categories.map(category =>
    `<button class="source-category-tab${state.sourceCategory === category ? ' active' : ''}" data-category="${esc(category)}">${esc(prettyCategory(category))}</button>`
  ).join('');
  categoryRoot.querySelectorAll('.source-category-tab').forEach(button => button.addEventListener('click', () => {
    state.sourceCategory = button.dataset.category || null; state.visibleCount = PAGE_SIZE; render();
  }));
  const items = filteredItems();
  $('#results-count').textContent = `${items.length} ${items.length === 1 ? 'wallpaper' : 'wallpapers'}`;
  $('#empty-state').classList.toggle('hidden', items.length !== 0);
  const visibleItems = items.slice(0, state.visibleCount);
  const loadMore = $('#load-more');
  loadMore.classList.toggle('hidden', items.length <= visibleItems.length);
  if (items.length > visibleItems.length) loadMore.textContent = `Load ${Math.min(PAGE_SIZE, items.length - visibleItems.length)} more (${items.length - visibleItems.length} remaining)`;
  grid.innerHTML = visibleItems.map((item, index) => {
    const badge = item.kind === 'live' ? '▶ LIVE' : '▧ STILL';
    const meta = [item.resolution, item.fps ? `${item.fps} FPS` : null].filter(Boolean).map(esc).join('<span>·</span>');
    const swatches = (item.colors || []).slice(0, 4).map(color => {
      const match = COLORS.find(c => c[0] === color);
      return match ? `<i class="swatch" title="${esc(color)}" style="background:${match[1]}"></i>` : '';
    }).join('');
    const image = previewUrl(item);
    const preview = image
      ? `<img src="${esc(image)}" alt="" loading="lazy">`
      : `<div class="card-placeholder"><span>${item.kind === 'live' ? '▶' : '✳'}</span><small>${esc(item.format || 'WALLPAPER')}</small></div>`;
    const contributor = item.submitter
      ? `<p class="card-contributor">Shared by <span>@${esc(item.submitter)}</span></p>`
      : item.creditName
        ? `<p class="card-contributor">Source: <a href="${esc(item.creditUrl || REPO_SOURCE.url)}" target="_blank" rel="noreferrer">${esc(item.creditName)}</a></p>`
        : '';
    const category = item.collection === 'cantony' ? `<span class="card-category">${esc(prettyCategory(item.sourceCategory || 'Unsorted'))}</span>` : '';
    return `<article class="card" tabindex="0" role="button" data-index="${index}" aria-label="Preview ${esc(item.name)}">
      <div class="card-image">${preview}<span class="badge kind">${badge}</span><span class="badge format">${esc(item.format)}</span></div>
      <div class="card-info"><h2 class="card-title" title="${esc(item.name)}">${esc(item.name)}</h2>${category}${contributor}<div class="card-meta"><span>${meta || 'Wallpaper'}</span><span class="swatches">${swatches}</span></div></div>
    </article>`;
  }).join('');
  grid.querySelectorAll('.card').forEach(card => {
    const open = event => { if (!event.target.closest('a')) showViewer(items[Number(card.dataset.index)]); };
    card.addEventListener('click', open);
    card.addEventListener('keydown', event => { if (event.target.closest('a')) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(event); } });
  });
}

function showViewer(item) {
  if (!item) return;
  const media = $('#viewer-media'); media.replaceChildren();
  let node;
  if (item.kind === 'live' && ['MP4','WEBM','MOV','MKV','AVI'].includes(item.format)) {
    node = document.createElement('video'); node.controls = true; node.autoplay = true; node.loop = true; node.playsInline = true;
    const source = document.createElement('source'); source.src = assetUrl(item); node.append(source);
  } else {
    node = document.createElement('img'); node.src = assetUrl(item); node.alt = item.name;
  }
  media.append(node);
  $('#viewer-kind').textContent = item.kind === 'live' ? 'Live wallpaper' : 'Still wallpaper';
  $('#viewer-name').textContent = item.name;
  $('#viewer-meta').textContent = [item.resolution, item.format, item.fps ? `${item.fps} FPS` : null, item.sourceCategory ? `Category: ${prettyCategory(item.sourceCategory)}` : null].filter(Boolean).join('  ·  ');
  const contributor = $('#viewer-contributor');
  contributor.replaceChildren();
  if (item.submitter) {
    contributor.textContent = `Submitted by @${item.submitter}`;
    contributor.classList.remove('hidden');
  } else if (item.creditName) {
    contributor.append(document.createTextNode('Source: '));
    const link = document.createElement('a');
    link.href = item.creditUrl || REPO_SOURCE.url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = item.creditName;
    contributor.append(link); contributor.classList.remove('hidden');
  } else {
    contributor.classList.add('hidden');
  }
  const download = $('#download-link'); download.href = downloadUrl(item); download.target = '_blank'; download.rel = 'noreferrer';
  $('#viewer').showModal();
}

function clearFilters() {
  state.kind = 'all'; state.color = null; state.sourceCategory = null; state.query = ''; state.visibleCount = PAGE_SIZE; $('#search').value = ''; render();
}

async function createPreview(file, kind) {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 300;
  const ctx = canvas.getContext('2d');
  if (kind === 'live' && file.type.startsWith('video/')) {
    const video = document.createElement('video'); const objectUrl = URL.createObjectURL(file);
    video.muted = true; video.playsInline = true; video.preload = 'metadata'; video.src = objectUrl;
    try {
      await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; setTimeout(() => reject(new Error('Video preview timeout')), 8000); });
      video.currentTime = Math.min(1, Math.max(0, video.duration / 3));
      await new Promise((resolve, reject) => { video.onseeked = resolve; video.onerror = reject; setTimeout(() => reject(new Error('Video seek timeout')), 8000); });
      drawCover(ctx, video, video.videoWidth, video.videoHeight);
    } finally { URL.revokeObjectURL(objectUrl); video.removeAttribute('src'); video.load(); }
  } else {
    const bitmap = await createImageBitmap(file);
    drawCover(ctx, bitmap, bitmap.width, bitmap.height); bitmap.close?.();
  }
  return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.74));
}

function drawCover(ctx, source, width, height) {
  const scale = Math.max(480 / width, 300 / height);
  const w = width * scale, h = height * scale;
  ctx.drawImage(source, (480 - w) / 2, (300 - h) / 2, w, h);
}

function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
async function communityRequest(path, options = {}) {
  return fetch(`${API_BASE}${path}`, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token()}` } });
}
function setUploadStatus(message, error = false) {
  const target = $('#upload-status'); target.textContent = message; target.classList.toggle('error', error);
}

async function initializeSubmission() {
  const dialog = $('#submit-dialog');
  $('#submit-open').addEventListener('click', async () => {
    dialog.showModal();
    await refreshSubmissionUser();
  });
  $('#submit-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  $('#github-login').addEventListener('click', event => {
    if (!API_BASE) { event.preventDefault(); $('#submit-status').textContent = 'The submission service has not been configured yet.'; }
  });
  if (API_BASE) $('#github-login').href = `${API_BASE}/auth/login`;
  const fragment = new URLSearchParams(location.hash.slice(1));
  const returnedToken = fragment.get('community-token');
  if (returnedToken) {
    localStorage.setItem(TOKEN_KEY, returnedToken);
    history.replaceState(null, '', location.pathname + location.search);
  }
  $('#submit-logout').addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY); $('#submit-user').classList.add('hidden'); $('#submit-form').classList.add('hidden'); $('#submit-auth').classList.remove('hidden');
  });
  $('#submit-form').addEventListener('submit', uploadSubmission);
  $('#wall-file').addEventListener('change', () => {
    const file = $('#wall-file').files[0];
    if (file && file.size >= MAX_UPLOAD_BYTES) setUploadStatus('Choose a file smaller than 99 MB.', true);
    else setUploadStatus('');
  });
  $('#submit-dialog').addEventListener('close', () => setUploadStatus(''));
}

async function refreshSubmissionUser() {
  if (!API_BASE) { $('#submit-status').textContent = 'Submission uploads are being configured.'; return; }
  if (!token()) { $('#submit-auth').classList.remove('hidden'); $('#submit-user').classList.add('hidden'); $('#submit-form').classList.add('hidden'); return; }
  try {
    const response = await communityRequest('/api/me');
    const body = await response.json();
    if (!response.ok || !body.user) throw new Error('Session expired. Sign in again.');
    $('#submit-auth').classList.add('hidden'); $('#submit-user').classList.remove('hidden'); $('#submit-form').classList.remove('hidden');
    $('#submit-user-name').textContent = `Signed in as @${body.user.login}`;
    $('#submit-quota').textContent = `${body.quota.remaining} of ${body.quota.dailyLimit} uploads left today`;
    $('#submit-status').textContent = '';
  } catch (error) {
    localStorage.removeItem(TOKEN_KEY);
    $('#submit-auth').classList.remove('hidden'); $('#submit-user').classList.add('hidden'); $('#submit-form').classList.add('hidden');
    $('#submit-status').textContent = error.message;
  }
}

async function uploadSubmission(event) {
  event.preventDefault();
  const button = $('#submit-button'); button.disabled = true;
  try {
    const file = $('#wall-file').files[0];
    const kind = $('#wall-kind').value;
    if (!file) throw new Error('Choose a wallpaper file first.');
    if (file.size <= 0 || file.size >= MAX_UPLOAD_BYTES) throw new Error('The file must be smaller than 99 MB.');
    if (!file.type) throw new Error('This file type is not supported by your browser.');
    const colors = [...document.querySelectorAll('input[name="wall-color"]:checked')].map(input => input.value);
    if (colors.length > 3) throw new Error('Choose no more than three color tags.');
    setUploadStatus('Preparing your submission…');
    const prepared = await communityRequest('/api/submissions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: $('#wall-title').value, creator: $('#wall-creator').value, sourceUrl: $('#wall-source').value, kind,
        fileName: file.name, contentType: file.type, size: file.size, colors, hasRights: $('#wall-rights').checked }),
    });
    const reservation = await prepared.json();
    if (!prepared.ok) throw new Error(reservation.error || 'Could not prepare the upload.');
    setUploadStatus('Uploading wallpaper…');
    const upload = await communityRequest(`/api/submissions/${encodeURIComponent(reservation.id)}/file`, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
    const uploaded = await upload.json();
    if (!upload.ok) throw new Error(uploaded.error || 'Upload failed.');
    let previewMessage = '';
    try {
      const preview = await createPreview(file, kind);
      if (preview && preview.size < 2_000_000) {
        const response = await communityRequest(`/api/submissions/${encodeURIComponent(reservation.id)}/preview`, { method: 'PUT', headers: { 'content-type': 'image/webp' }, body: preview });
        if (!response.ok) previewMessage = ' (The preview could not be saved; moderators can still review the original.)';
      }
    } catch { previewMessage = ' (A preview could not be generated; moderators can still review the original.)'; }
    $('#submit-form').reset();
    await refreshSubmissionUser();
    setUploadStatus(`Thanks! Your wallpaper is in the moderation queue.${previewMessage}`);
  } catch (error) {
    setUploadStatus(error.message || 'The upload failed. Please try again.', true);
  } finally { button.disabled = false; }
}

async function loadCollection() {
  try {
    const response = await fetch('catalog.json');
    if (!response.ok) throw new Error('Could not load catalog');
    const items = await response.json();
    items.forEach(item => { item.collection ||= 'personal'; });
    const personalCount = items.filter(item => item.collection === 'personal').length;
    let communityCount = 0;
    if (API_BASE) {
      try {
        const community = await fetch(`${API_BASE}/api/wallpapers`);
        if (community.ok) {
          const communityItems = await community.json();
          communityItems.forEach(item => { item.collection = 'community'; });
          communityCount = communityItems.length;
          items.push(...communityItems);
        }
      } catch {}
    }
    let cantonyItems = [];
    try {
      const source = await loadCantonyCollection();
      cantonyItems = source.items;
      $('#source-status').textContent = source.truncated ? 'Showing the files GitHub returned; its file listing is truncated for this very large repository.' : '';
      $('#source-status').classList.toggle('hidden', !source.truncated);
    } catch (error) {
      $('#source-status').textContent = `Could not load CantonyEddy’s GitHub wallpaper list (${error.message}).`;
      $('#source-status').classList.remove('hidden');
      console.warn('Could not load CantonyEddy wallpaper list:', error);
    }
    items.push(...cantonyItems);
    state.items = items;
    $('#personal-tab-count').textContent = personalCount;
    $('#community-tab-count').textContent = communityCount;
    $('#cantony-tab-count').textContent = cantonyItems.length;
    $('#everything-tab-count').textContent = items.length;
    const still = items.filter(item => item.kind === 'still').length;
    const live = items.filter(item => item.kind === 'live').length;
    $('#total-count').textContent = items.length; $('#still-count').textContent = still; $('#live-count').textContent = live;
    $('#all-tab-count').textContent = items.length; render();
  } catch { $('#results-count').textContent = 'Could not load wallpapers. Please refresh the page.'; }
}

setupColors();
document.querySelectorAll('.collection-tab').forEach(button => button.addEventListener('click', () => { state.collection = button.dataset.collection; state.sourceCategory = null; state.visibleCount = PAGE_SIZE; render(); }));
document.querySelectorAll('.type-tab').forEach(button => button.addEventListener('click', () => { state.kind = button.dataset.kind; state.visibleCount = PAGE_SIZE; render(); }));
$('#search').addEventListener('input', event => { state.query = event.target.value; state.visibleCount = PAGE_SIZE; render(); });
$('#load-more').addEventListener('click', () => { state.visibleCount += PAGE_SIZE; render(); });
$('#refresh-source').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true; button.textContent = 'Refreshing…';
  try { localStorage.removeItem(SOURCE_CACHE_KEY); } catch {}
  await loadCollection();
  button.disabled = false; button.textContent = 'Refresh source';
});
$('#clear-filters').addEventListener('click', clearFilters); $('#empty-clear').addEventListener('click', clearFilters);
$('#viewer-close').addEventListener('click', () => $('#viewer').close());
$('#viewer').addEventListener('click', event => { if (event.target === $('#viewer')) $('#viewer').close(); });
$('#viewer').addEventListener('close', () => $('#viewer-media').replaceChildren());
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#search').focus(); } });
initializeSubmission();
loadCollection();
