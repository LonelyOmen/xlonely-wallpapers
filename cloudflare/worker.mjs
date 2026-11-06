const MAX_UPLOAD_BYTES = 99_000_000;
const MAX_PREVIEW_BYTES = 2_000_000;
const DEFAULT_DAILY_LIMIT = 5;
const DEFAULT_STORAGE_LIMIT = 8 * 1024 * 1024 * 1024;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIME = {
  'image/jpeg': { ext: 'jpg', kind: 'still' },
  'image/png': { ext: 'png', kind: 'still' },
  'image/webp': { ext: 'webp', kind: 'still' },
  'image/gif': { ext: 'gif', kind: 'live' },
  'video/mp4': { ext: 'mp4', kind: 'live' },
  'video/webm': { ext: 'webm', kind: 'live' },
  'video/quicktime': { ext: 'mov', kind: 'live' },
};
const PREVIEW_MIME = new Set(['image/webp', 'image/jpeg', 'image/png']);
const enc = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function cors(response, request, env) {
  const origin = request.headers.get('Origin');
  const allowed = origin === env.SITE_ORIGIN;
  const headers = new Headers(response.headers);
  if (allowed) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
    headers.set('access-control-allow-headers', 'Authorization, Content-Type, Range');
    headers.set('access-control-expose-headers', 'Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag');
    headers.set('vary', 'Origin');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function b64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), ch => ch.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}

async function makeToken(user, env) {
  const payload = b64url(enc.encode(JSON.stringify({
    sub: String(user.id), login: user.login, exp: Math.floor(Date.now() / 1000) + Number(env.SESSION_TTL_SECONDS || SESSION_TTL_SECONDS),
  })));
  return `${payload}.${b64url(await hmac(env.SESSION_SECRET, payload))}`;
}

async function readToken(request, env) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  if (!match || !env.SESSION_SECRET) return null;
  const [payload, signature, extra] = match[1].split('.');
  if (!payload || !signature || extra) return null;
  const expected = await hmac(env.SESSION_SECRET, payload);
  const received = fromB64url(signature);
  if (expected.length !== received.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ received[i];
  if (diff !== 0) return null;
  try {
    const user = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return user.exp > Date.now() / 1000 && user.sub && user.login ? user : null;
  } catch { return null; }
}

function cookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const part = header.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}

function csvColors(value) {
  const allowed = new Set(['red','orange','yellow','green','blue','purple','pink','white','black']);
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(item => typeof item === 'string' && allowed.has(item)))].slice(0, 3);
}

function validSourceUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href.slice(0, 500) : '';
  } catch { return ''; }
}

async function authenticated(request, env) {
  return readToken(request, env);
}

async function requireUser(request, env) {
  const user = await authenticated(request, env);
  if (!user) throw new HttpError(401, 'Sign in with GitHub to continue.');
  return user;
}

function requireAdmin(user, env) {
  if (!user || user.login.toLowerCase() !== String(env.ADMIN_GITHUB_LOGIN || '').toLowerCase()) {
    throw new HttpError(403, 'Moderator access required.');
  }
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function quotaFor(user, env) {
  const dailyLimit = Number(env.DAILY_UPLOAD_LIMIT || DEFAULT_DAILY_LIMIT);
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE user_id = ? AND substr(created_at, 1, 10) = date('now')")
    .bind(user.sub).first();
  return { dailyLimit, used: Number(used?.n || 0), remaining: Math.max(0, dailyLimit - Number(used?.n || 0)) };
}

async function storageUsed(env) {
  const result = await env.DB.prepare(`
    SELECT COALESCE(SUM(size + preview_size), 0) AS bytes
    FROM submissions
    WHERE status IN ('pending', 'approved')
       OR (status = 'reserved' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'))
  `).first();
  return Number(result?.bytes || 0);
}

async function startLogin(request, env) {
  if (!env.GITHUB_CLIENT_ID || !env.SITE_ORIGIN) throw new HttpError(503, 'Community sign-in is not configured yet.');
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const callback = `${new URL(request.url).origin}/auth/callback`;
  const target = new URL('https://github.com/login/oauth/authorize');
  target.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  target.searchParams.set('redirect_uri', callback);
  target.searchParams.set('scope', 'read:user');
  target.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: {
    location: target.href,
    'set-cookie': `wallpaper_oauth_state=${encodeURIComponent(state)}; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax`,
    'cache-control': 'no-store',
  } });
}

async function finishLogin(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  if (!state || !cookie(request, 'wallpaper_oauth_state') || state !== cookie(request, 'wallpaper_oauth_state')) {
    throw new HttpError(400, 'GitHub sign-in state did not match. Please try again.');
  }
  if (!env.GITHUB_CLIENT_SECRET) throw new HttpError(503, 'Community sign-in is not configured yet.');
  const code = url.searchParams.get('code');
  if (!code) throw new HttpError(400, 'GitHub did not return a sign-in code.');
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'xLonely-Wallpaper-Community' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) throw new HttpError(401, 'GitHub sign-in failed. Please try again.');
  const profileResponse = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${tokenData.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'xLonely-Wallpaper-Community' },
  });
  const profile = await profileResponse.json();
  if (!profileResponse.ok || !profile.id || !profile.login) throw new HttpError(401, 'Could not read your GitHub profile.');
  const token = await makeToken(profile, env);
  const destination = new URL(env.SITE_URL || env.SITE_ORIGIN);
  destination.hash = `community-token=${token}`;
  return new Response(null, { status: 302, headers: {
    location: destination.href,
    'set-cookie': 'wallpaper_oauth_state=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax',
    'cache-control': 'no-store',
  } });
}

function detectedType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 6 && ['GIF87a','GIF89a'].includes(new TextDecoder().decode(bytes.slice(0, 6)))) return 'image/gif';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 12)) === 'ftypqt  ') return 'video/quicktime';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp') return 'video/mp4';
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  return '';
}

async function inspectStream(stream) {
  const [inspect, upload] = stream.tee();
  const reader = inspect.getReader();
  const prefix = new Uint8Array(16);
  let offset = 0;
  while (offset < prefix.length) {
    const { value, done } = await reader.read();
    if (done) break;
    const take = Math.min(value.length, prefix.length - offset);
    prefix.set(value.subarray(0, take), offset);
    offset += take;
    if (offset >= prefix.length) { await reader.cancel(); break; }
  }
  await reader.cancel().catch(() => {});
  return { type: detectedType(prefix.subarray(0, offset)), upload };
}

function contentDisposition(filename, disposition = 'inline') {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'wallpaper';
  return `${disposition}; filename="${safe}"`;
}

function rangeFor(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return { invalid: true };
  let offset, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!suffix) return { invalid: true };
    offset = Math.max(0, size - suffix); end = size - 1;
  } else {
    offset = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
  }
  if (offset >= size || end < offset) return { invalid: true };
  const last = Math.min(end, size - 1);
  return { offset, length: last - offset + 1, end: last };
}

async function serveBucketObject(request, bucket, key, size, filename, download) {
  const range = rangeFor(request.headers.get('Range'), size);
  if (range?.invalid) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  const object = await bucket.get(key, range ? { range: request.headers } : {});
  if (!object) throw new HttpError(404, 'Uploaded file not found.');
  const headers = new Headers({
    'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
    'cache-control': 'public, max-age=3600',
    'accept-ranges': 'bytes',
    'content-disposition': contentDisposition(filename, download ? 'attachment' : 'inline'),
    etag: object.httpEtag,
  });
  if (range) {
    headers.set('content-length', String(range.length));
    headers.set('content-range', `bytes ${range.offset}-${range.end}/${size}`);
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('content-length', String(size));
  return new Response(object.body, { headers });
}

async function handleApi(request, env, url) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method === 'GET' && url.pathname === '/api/me') {
    const user = await authenticated(request, env);
    if (!user) return json({ user: null });
    return json({ user: { id: user.sub, login: user.login }, admin: user.login.toLowerCase() === String(env.ADMIN_GITHUB_LOGIN || '').toLowerCase(), quota: await quotaFor(user, env) });
  }
  if (request.method === 'GET' && url.pathname === '/api/wallpapers') {
    const result = await env.DB.prepare(`
      SELECT id, title, kind, format, colors_json, preview_size
      FROM submissions WHERE status = 'approved' ORDER BY reviewed_at DESC
    `).all();
    const base = url.origin;
    const items = (result.results || []).map(row => ({
      name: row.title,
      kind: row.kind,
      format: row.format,
      colors: JSON.parse(row.colors_json || '[]'),
      file: `${base}/api/assets/${row.id}?download=1`,
      assetUrl: `${base}/api/assets/${row.id}`,
      previewUrl: row.preview_size ? `${base}/api/assets/${row.id}/preview` : null,
      bytes: 0,
    }));
    return json(items, 200, { 'cache-control': 'public, max-age=60' });
  }
  if (request.method === 'POST' && url.pathname === '/api/submissions') {
    const user = await requireUser(request, env);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid submission details.');
    const title = String(body.title || '').trim().slice(0, 80);
    const creator = String(body.creator || '').trim().slice(0, 80);
    const sourceUrl = validSourceUrl(String(body.sourceUrl || '').trim());
    const originalName = String(body.fileName || '').trim().slice(0, 200);
    const contentType = String(body.contentType || '').toLowerCase();
    const type = MIME[contentType];
    const size = Number(body.size);
    const kind = String(body.kind || '');
    if (!title || !originalName || !type || !Number.isSafeInteger(size) || size <= 0 || size >= Number(env.MAX_UPLOAD_BYTES || MAX_UPLOAD_BYTES)) {
      throw new HttpError(400, 'Choose a supported image/video smaller than 99 MB and enter a title.');
    }
    if (kind !== type.kind && !(contentType === 'image/gif' && kind === 'still')) throw new HttpError(400, 'The selected still/live type does not match this file.');
    if (body.hasRights !== true) throw new HttpError(400, 'Confirm that you have permission to share this wallpaper.');
    const id = crypto.randomUUID();
    const storageLimit = Number(env.MAX_STORAGE_BYTES || DEFAULT_STORAGE_LIMIT);
    const dailyLimit = Number(env.DAILY_UPLOAD_LIMIT || DEFAULT_DAILY_LIMIT);
    const insert = await env.DB.prepare(`
      INSERT INTO submissions (id, user_id, github_login, status, title, creator, source_url, kind, format, content_type, original_name, object_key, size, colors_json)
      SELECT ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM submissions WHERE user_id = ? AND substr(created_at, 1, 10) = date('now')) < ?
        AND (SELECT COALESCE(SUM(size + preview_size), 0) FROM submissions
             WHERE status IN ('pending', 'approved')
                OR (status = 'reserved' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'))) + ? <= ?
    `).bind(
      id, user.sub, user.login, title, creator, sourceUrl, kind, type.ext.toUpperCase(), contentType,
      originalName, `${id}.${type.ext}`, size, JSON.stringify(csvColors(body.colors)),
      user.sub, dailyLimit, size, storageLimit,
    ).run();
    if (!insert.meta?.changes) {
      const quota = await quotaFor(user, env);
      if (quota.remaining === 0) throw new HttpError(429, `Daily limit reached: ${dailyLimit} uploads per UTC day.`);
      throw new HttpError(507, 'The community upload storage is full for now. Please try again later.');
    }
    return json({ id, uploadUrl: `${url.origin}/api/submissions/${id}/file`, maxBytes: Number(env.MAX_UPLOAD_BYTES || MAX_UPLOAD_BYTES), quota: await quotaFor(user, env) }, 201);
  }
  const uploadMatch = /^\/api\/submissions\/([0-9a-f-]+)\/file$/.exec(url.pathname);
  if (request.method === 'PUT' && uploadMatch) {
    const user = await requireUser(request, env);
    const id = uploadMatch[1];
    const row = await env.DB.prepare("SELECT * FROM submissions WHERE id = ? AND user_id = ? AND status = 'reserved' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')").bind(id, user.sub).first();
    if (!row) throw new HttpError(404, 'Upload reservation not found or expired.');
    const contentLength = Number(request.headers.get('Content-Length'));
    if (!Number.isSafeInteger(contentLength) || contentLength !== Number(row.size) || contentLength >= Number(env.MAX_UPLOAD_BYTES || MAX_UPLOAD_BYTES)) {
      throw new HttpError(413, 'Upload size did not match the reservation or exceeded the 99 MB limit.');
    }
    if (!request.body) throw new HttpError(400, 'No file was uploaded.');
    const inspected = await inspectStream(request.body);
    if (inspected.type !== row.content_type) throw new HttpError(415, 'The file contents do not match the selected file type.');
    const stored = await env.WALLPAPERS.put(row.object_key, inspected.upload, {
      httpMetadata: { contentType: row.content_type, cacheControl: 'public, max-age=3600' },
      customMetadata: { submissionId: id, uploader: row.github_login },
    });
    if (stored.size !== Number(row.size) || stored.size >= Number(env.MAX_UPLOAD_BYTES || MAX_UPLOAD_BYTES)) {
      await env.WALLPAPERS.delete(row.object_key);
      throw new HttpError(400, 'Uploaded file size did not match the reservation.');
    }
    try {
      const changed = await env.DB.prepare("UPDATE submissions SET status = 'pending', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ? AND status = 'reserved'").bind(id, user.sub).run();
      if (!changed.meta?.changes) throw new Error('Upload reservation changed during transfer.');
    } catch (error) {
      await env.WALLPAPERS.delete(row.object_key);
      throw error;
    }
    return json({ ok: true, message: 'Uploaded for moderator review.', quota: await quotaFor(user, env) }, 201);
  }
  const previewMatch = /^\/api\/submissions\/([0-9a-f-]+)\/preview$/.exec(url.pathname);
  if (request.method === 'PUT' && previewMatch) {
    const user = await requireUser(request, env);
    const id = previewMatch[1];
    const row = await env.DB.prepare("SELECT * FROM submissions WHERE id = ? AND user_id = ? AND status = 'pending'").bind(id, user.sub).first();
    if (!row) throw new HttpError(404, 'Submission not found.');
    const length = Number(request.headers.get('Content-Length'));
    const contentType = String(request.headers.get('Content-Type') || '').split(';')[0].toLowerCase();
    if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_PREVIEW_BYTES || !PREVIEW_MIME.has(contentType)) {
      throw new HttpError(400, 'Preview must be a small WebP, JPEG, or PNG image under 2 MB.');
    }
    if (await storageUsed(env) + length > Number(env.MAX_STORAGE_BYTES || DEFAULT_STORAGE_LIMIT)) throw new HttpError(507, 'Community storage is full for now.');
    if (Number(row.preview_size) > 0) throw new HttpError(409, 'A preview has already been uploaded.');
    if (!request.body) throw new HttpError(400, 'No preview was uploaded.');
    const inspected = await inspectStream(request.body);
    if (inspected.type !== contentType) throw new HttpError(415, 'Preview content does not match its image type.');
    const previewKey = `${id}-preview`;
    const object = await env.WALLPAPERS.put(previewKey, inspected.upload, {
      httpMetadata: { contentType, cacheControl: 'public, max-age=3600' },
      customMetadata: { submissionId: id, role: 'preview' },
    });
    if (object.size !== length || object.size > MAX_PREVIEW_BYTES) {
      await env.WALLPAPERS.delete(previewKey);
      throw new HttpError(400, 'Preview size did not match the upload.');
    }
    try {
      const changed = await env.DB.prepare("UPDATE submissions SET preview_size = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ? AND status = 'pending' AND preview_size = 0").bind(object.size, id, user.sub).run();
      if (!changed.meta?.changes) throw new Error('Preview reservation changed during transfer.');
    } catch (error) {
      await env.WALLPAPERS.delete(previewKey);
      throw error;
    }
    return json({ ok: true });
  }
  const adminList = url.pathname === '/api/admin/submissions' && request.method === 'GET';
  if (adminList) {
    const user = await requireUser(request, env); requireAdmin(user, env);
    const result = await env.DB.prepare("SELECT id, github_login, created_at, title, creator, source_url, kind, format, size, colors_json, preview_size FROM submissions WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100").all();
    return json((result.results || []).map(row => ({ ...row, colors: JSON.parse(row.colors_json || '[]'), colors_json: undefined, fileUrl: `${url.origin}/api/admin/submissions/${row.id}/file`, previewUrl: row.preview_size ? `${url.origin}/api/admin/submissions/${row.id}/preview` : null, hasPreview: Number(row.preview_size) > 0 })));
  }
  const adminFile = /^\/api\/admin\/submissions\/([0-9a-f-]+)\/(file|preview)$/.exec(url.pathname);
  if (request.method === 'GET' && adminFile) {
    const user = await requireUser(request, env); requireAdmin(user, env);
    const row = await env.DB.prepare("SELECT * FROM submissions WHERE id = ? AND status = 'pending'").bind(adminFile[1]).first();
    if (!row) throw new HttpError(404, 'Pending submission not found.');
    const preview = adminFile[2] === 'preview';
    if (preview && !row.preview_size) throw new HttpError(404, 'Preview not uploaded.');
    return serveBucketObject(request, env.WALLPAPERS, preview ? `${row.id}-preview` : row.object_key, preview ? Number(row.preview_size) : Number(row.size), preview ? `${row.id}-preview.webp` : row.original_name, false);
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/review') {
    const user = await requireUser(request, env); requireAdmin(user, env);
    const body = await request.json().catch(() => null);
    const id = String(body?.id || '');
    const decision = String(body?.decision || '');
    const row = await env.DB.prepare("SELECT * FROM submissions WHERE id = ? AND status = 'pending'").bind(id).first();
    if (!row) throw new HttpError(404, 'Pending submission not found.');
    if (decision === 'approve') {
      await env.DB.prepare("UPDATE submissions SET status = 'approved', reviewed_by = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'pending'").bind(user.login, id).run();
    } else if (decision === 'reject') {
      await env.WALLPAPERS.delete(row.object_key);
      await env.WALLPAPERS.delete(`${id}-preview`);
      await env.DB.prepare("UPDATE submissions SET status = 'rejected', size = 0, preview_size = 0, reviewed_by = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'pending'").bind(user.login, id).run();
    } else throw new HttpError(400, 'Decision must be approve or reject.');
    return json({ ok: true });
  }
  const assetMatch = /^\/api\/assets\/([0-9a-f-]+)(\/preview)?$/.exec(url.pathname);
  if (request.method === 'GET' && assetMatch) {
    const row = await env.DB.prepare("SELECT * FROM submissions WHERE id = ? AND status = 'approved'").bind(assetMatch[1]).first();
    if (!row) throw new HttpError(404, 'Wallpaper not found.');
    const preview = Boolean(assetMatch[2]);
    if (preview && !row.preview_size) throw new HttpError(404, 'Preview not found.');
    return serveBucketObject(request, env.WALLPAPERS, preview ? `${row.id}-preview` : row.object_key, preview ? Number(row.preview_size) : Number(row.size), preview ? `${row.id}-preview.webp` : row.original_name, url.searchParams.get('download') === '1');
  }
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/auth/login') return await startLogin(request, env);
      if (request.method === 'GET' && url.pathname === '/auth/callback') return await finishLogin(request, env);
      const response = await handleApi(request, env, url);
      return cors(response, request, env);
    } catch (error) {
      const response = json({ error: error instanceof HttpError ? error.message : 'The request could not be completed.' }, error instanceof HttpError ? error.status : 500);
      return cors(response, request, env);
    }
  },
};
