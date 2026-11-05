const COLORS = [
  ['red', '#ef5350'], ['orange', '#ff9f43'], ['yellow', '#f8d44e'],
  ['green', '#53b66d'], ['blue', '#4e9ee9'], ['purple', '#9b72cf'],
  ['pink', '#e868a2'], ['white', '#f3f0f5'], ['black', '#24222b']
];
const state = { items: [], kind: 'all', color: null, query: '' };
const $ = (selector) => document.querySelector(selector);
const grid = $('#wallpaper-grid');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url = (path) => path.split('/').map(encodeURIComponent).join('/');

function setupColors() {
  const root = $('#color-filters');
  COLORS.forEach(([name, color]) => {
    const button = document.createElement('button');
    button.className = 'color-filter';
    button.dataset.color = name;
    button.title = `Filter ${name}`;
    button.setAttribute('aria-label', `Filter ${name}`);
    button.setAttribute('aria-pressed', 'false');
    button.style.backgroundColor = color;
    button.addEventListener('click', () => {
      state.color = state.color === name ? null : name;
      render();
    });
    root.append(button);
  });
}

function filteredItems() {
  const q = state.query.trim().toLocaleLowerCase();
  return state.items.filter(item =>
    (state.kind === 'all' || item.kind === state.kind) &&
    (!state.color || (item.colors || []).includes(state.color)) &&
    (!q || `${item.name} ${item.format} ${item.kind} ${(item.colors || []).join(' ')}`.toLocaleLowerCase().includes(q))
  );
}

function render() {
  document.querySelectorAll('.type-tab').forEach(button => {
    const active = button.dataset.kind === state.kind;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.color-filter').forEach(button => {
    const active = button.dataset.color === state.color;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const items = filteredItems();
  $('#results-count').textContent = `${items.length} ${items.length === 1 ? 'wallpaper' : 'wallpapers'}`;
  $('#empty-state').classList.toggle('hidden', items.length !== 0);
  grid.innerHTML = items.map((item, index) => {
    const badge = item.kind === 'live' ? '▶ LIVE' : '▧ STILL';
    const meta = [item.resolution, item.fps ? `${item.fps} FPS` : null].filter(Boolean).map(esc).join('<span>·</span>');
    const swatches = (item.colors || []).slice(0, 4).map(color => {
      const match = COLORS.find(c => c[0] === color);
      return match ? `<i class="swatch" title="${esc(color)}" style="background:${match[1]}"></i>` : '';
    }).join('');
    return `<article class="card" tabindex="0" role="button" data-index="${index}" aria-label="Preview ${esc(item.name)}">
      <div class="card-image"><img src="${url(item.preview)}" alt="" loading="lazy"><span class="badge kind">${badge}</span><span class="badge format">${esc(item.format)}</span></div>
      <div class="card-info"><h2 class="card-title" title="${esc(item.name)}">${esc(item.name)}</h2><div class="card-meta"><span>${meta || 'Wallpaper'}</span><span class="swatches">${swatches}</span></div></div>
    </article>`;
  }).join('');
  grid.querySelectorAll('.card').forEach(card => {
    const open = () => showViewer(items[Number(card.dataset.index)]);
    card.addEventListener('click', open);
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
}

function showViewer(item) {
  if (!item) return;
  const media = $('#viewer-media');
  media.replaceChildren();
  let node;
  if (item.kind === 'live' && ['MP4','WEBM','MOV','MKV','AVI'].includes(item.format)) {
    node = document.createElement('video');
    node.controls = true;
    node.autoplay = true;
    node.loop = true;
    node.playsInline = true;
    const source = document.createElement('source');
    source.src = url(item.file);
    node.append(source);
  } else {
    node = document.createElement('img');
    node.src = url(item.file);
    node.alt = item.name;
  }
  media.append(node);
  $('#viewer-kind').textContent = item.kind === 'live' ? 'Live wallpaper' : 'Still wallpaper';
  $('#viewer-name').textContent = item.name;
  $('#viewer-meta').textContent = [item.resolution, item.format, item.fps ? `${item.fps} FPS` : null].filter(Boolean).join('  ·  ');
  const download = $('#download-link');
  download.href = url(item.file);
  download.download = item.file.split('/').pop();
  $('#viewer').showModal();
}

function clearFilters() {
  state.kind = 'all'; state.color = null; state.query = '';
  $('#search').value = '';
  render();
}

setupColors();
document.querySelectorAll('.type-tab').forEach(button => button.addEventListener('click', () => { state.kind = button.dataset.kind; render(); }));
$('#search').addEventListener('input', event => { state.query = event.target.value; render(); });
$('#clear-filters').addEventListener('click', clearFilters);
$('#empty-clear').addEventListener('click', clearFilters);
$('#viewer-close').addEventListener('click', () => $('#viewer').close());
$('#viewer').addEventListener('click', event => { if (event.target === $('#viewer')) $('#viewer').close(); });
$('#viewer').addEventListener('close', () => $('#viewer-media').replaceChildren());
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#search').focus(); }
});
fetch('catalog.json').then(response => { if (!response.ok) throw new Error('Could not load catalog'); return response.json(); }).then(items => {
  state.items = items;
  const still = items.filter(item => item.kind === 'still').length;
  const live = items.filter(item => item.kind === 'live').length;
  $('#total-count').textContent = items.length;
  $('#still-count').textContent = still;
  $('#live-count').textContent = live;
  $('#all-tab-count').textContent = items.length;
  render();
}).catch(() => { $('#results-count').textContent = 'Could not load wallpapers. Please refresh the page.'; });
