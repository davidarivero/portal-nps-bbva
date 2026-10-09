'use strict';
/*
 * Portal de seguimiento de iniciativas · Mejora NPS WLAN
 * Servidor sin dependencias externas: Node.js 22.13+ (http, crypto y sqlite integrados).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const seed = require('./seed');
const initRecorridos = require('./recorridos');
const initRediseno = require('./rediseno');

const scrypt = promisify(crypto.scrypt);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const MIN_PASSWORD = 10;
const ROLES = ['admin', 'ingeniero', 'consulta'];

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'portal.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    role TEXT NOT NULL, pass_hash TEXT NOT NULL, salt TEXT NOT NULL,
    must_change INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS initiatives (
    id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, sort INTEGER NOT NULL, def TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY, initiative_id INTEGER NOT NULL REFERENCES initiatives(id),
    week_start TEXT NOT NULL, vals TEXT NOT NULL, detail TEXT NOT NULL,
    sede TEXT, evidence_url TEXT,
    created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL,
    UNIQUE (initiative_id, week_start)
  );
  CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY, initiative_id INTEGER NOT NULL REFERENCES initiatives(id),
    date TEXT, date_end TEXT, label TEXT, text TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY, ts TEXT NOT NULL, user_id INTEGER, action TEXT NOT NULL, detail TEXT
  );
`);

const now = () => new Date().toISOString();
const audit = (userId, action, detail) =>
  db.prepare('INSERT INTO audit (ts, user_id, action, detail) VALUES (?,?,?,?)')
    .run(now(), userId ?? null, action, detail ? JSON.stringify(detail) : null);

/* ---------- contraseñas y sesiones ---------- */
async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const buf = await scrypt(password.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 });
  return { hash: buf.toString('hex'), salt };
}
async function verifyPassword(password, user) {
  const { hash } = await hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.pass_hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)')
    .run(sha256(token), userId, Date.now() + SESSION_HOURS * 3600e3);
  return token;
}
function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
function currentUser(req) {
  const token = readCookie(req, 'sid');
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.username, u.name, u.role, u.must_change, u.active, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  return row;
}
function sessionCookie(req, token, maxAge) {
  const secure = COOKIE_SECURE || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
  return `sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600e3).unref();

/* ---------- bloqueo por intentos fallidos ---------- */
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60e3;
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}
function lockedFor(key) {
  const a = attempts.get(key);
  if (!a) return 0;
  if (a.until && a.until > Date.now()) return a.until - Date.now();
  if (a.until) attempts.delete(key);
  return 0;
}
function registerFailure(key) {
  const a = attempts.get(key) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) { a.until = Date.now() + LOCK_MS; a.count = 0; }
  attempts.set(key, a);
}

/* ---------- datos iniciales ---------- */
function seedDatabase() {
  if (db.prepare('SELECT COUNT(*) AS n FROM initiatives').get().n > 0) return;
  const insI = db.prepare('INSERT INTO initiatives (slug, sort, def) VALUES (?,?,?)');
  const insR = db.prepare(`INSERT INTO records (initiative_id, week_start, vals, detail, sede, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?)`);
  const insM = db.prepare('INSERT INTO milestones (initiative_id, date, date_end, label, text, sort) VALUES (?,?,?,?,?,?)');
  seed.initiatives.forEach((it, i) => {
    const { slug, milestones, seed: first, ...def } = it;
    const id = Number(insI.run(slug, i, JSON.stringify(def)).lastInsertRowid);
    if (first) insR.run(id, seed.baseWeek, JSON.stringify(first.values), first.detail, first.sede || null, now(), now());
    (milestones || []).forEach((m, j) => insM.run(id, m.date || null, m.dateEnd || null, m.label || null, m.text, j));
  });
}
async function ensureAdmin() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const username = (process.env.ADMIN_USER || 'admin').toLowerCase();
  const given = process.env.ADMIN_PASSWORD;
  const password = given || crypto.randomBytes(9).toString('base64url');
  const { hash, salt } = await hashPassword(password);
  db.prepare('INSERT INTO users (username, name, role, pass_hash, salt, must_change, created_at) VALUES (?,?,?,?,?,1,?)')
    .run(username, 'Administrador', 'admin', hash, salt, now());
  console.log('\n  Se creó el usuario administrador inicial.');
  console.log(`    Usuario:    ${username}`);
  console.log(`    Contraseña: ${given ? '(la definida en ADMIN_PASSWORD)' : password}`);
  console.log('  El portal pedirá cambiarla en el primer inicio de sesión.\n');
}

/* ---------- utilidades HTTP ---------- */
class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isObj ? JSON.stringify(body) : (body ?? '');
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      return reject(new HttpError(415, 'Se esperaba contenido JSON.'));
    }
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new HttpError(413, 'La solicitud es demasiado grande.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch { reject(new HttpError(400, 'El contenido enviado no es válido.')); }
    });
    req.on('error', reject);
  });
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'No encontrado');
    const ext = path.extname(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300',
    });
    res.end(buf);
  });
}

/* ---------- validación ---------- */
const str = (v, max, label, { required = false, min = 0 } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `Falta el campo: ${label}.`);
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${label} no es válido.`);
  const s = v.trim();
  if (required && s.length < Math.max(min, 1)) throw new HttpError(400, `${label}: escribe al menos ${Math.max(min, 1)} caracteres.`);
  if (s.length > max) throw new HttpError(400, `${label}: máximo ${max} caracteres.`);
  return s || null;
};
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function validateValues(fields, input) {
  const out = {};
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Faltan los valores de la métrica.');
  for (const f of fields) {
    const raw = input[f.key];
    if (raw === undefined || raw === null || raw === '') {
      if (f.required) throw new HttpError(400, `Falta el campo: ${f.label}.`);
      continue;
    }
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(n)) throw new HttpError(400, `${f.label}: debe ser un número.`);
    if (f.integer && !Number.isInteger(n)) throw new HttpError(400, `${f.label}: debe ser un número entero.`);
    if (f.min !== undefined && n < f.min) throw new HttpError(400, `${f.label}: el mínimo es ${f.min}.`);
    if (f.max !== undefined && n > f.max) throw new HttpError(400, `${f.label}: el máximo es ${f.max}.`);
    out[f.key] = n;
  }
  for (const f of fields) {
    if (f.maxField && out[f.key] !== undefined && out[f.maxField] !== undefined && out[f.key] > out[f.maxField]) {
      const other = fields.find((x) => x.key === f.maxField);
      throw new HttpError(400, `${f.label} no puede ser mayor que "${other.label}".`);
    }
  }
  return out;
}
function validatePassword(p) {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) throw new HttpError(400, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
  if (p.length > 200) throw new HttpError(400, 'La contraseña es demasiado larga.');
  return p;
}
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, mustChange: !!u.must_change });

/* ---------- consultas ---------- */
function loadData() {
  const initiatives = db.prepare('SELECT id, slug, def FROM initiatives ORDER BY sort').all().map((r) => ({
    slug: r.slug, ...JSON.parse(r.def),
    milestones: db.prepare(`SELECT id, date, date_end AS dateEnd, label, text, created_by AS createdBy FROM milestones
      WHERE initiative_id = ? ORDER BY (date IS NULL), date, sort, id`).all(r.id),
  }));
  const records = db.prepare(`SELECT r.id, i.slug AS initiative, r.week_start AS week, r.vals, r.detail, r.sede,
      r.evidence_url AS evidenceUrl, r.updated_at AS updatedAt, r.created_by AS createdBy,
      COALESCE(u.name, 'Documento base') AS author
    FROM records r JOIN initiatives i ON i.id = r.initiative_id
    LEFT JOIN users u ON u.id = COALESCE(r.updated_by, r.created_by)
    ORDER BY r.week_start`).all().map((r) => ({ ...r, values: JSON.parse(r.vals), vals: undefined }));
  // Recorridos proactivos: el valor semanal sale de los recorridos diarios completos.
  let merged = records;
  if (recorridos && initiatives.some((i) => i.slug === 'recorridos')) {
    const weeks = recorridos.weeklySummary();
    const legacy = new Map(records.filter((r) => r.initiative === 'recorridos').map((r) => [r.week, r]));
    merged = records.filter((r) => !(r.initiative === 'recorridos' && weeks.some((w) => w.week === r.week)));
    for (const w of weeks) {
      // Semana de transición: si ya había un registro semanal, se conserva el mayor de los dos valores.
      const old = legacy.get(w.week);
      const prev = old ? Number(old.values.recorridos) || 0 : 0;
      merged.push({
        id: null, auto: true, initiative: 'recorridos', week: w.week, values: { recorridos: Math.max(w.completos, prev) },
        detail: `${w.completos} recorridos completos registrados por día en el portal${w.sedes.length ? ` (${w.sedes.join(', ')})` : ''}.${w.enCurso ? ` ${w.enCurso} más en curso.` : ''}${old ? ` Registro semanal anterior: ${prev}.` : ''}`,
        sede: w.sedes.join(', '), evidenceUrl: null, updatedAt: w.updatedAt, createdBy: null, author: 'Recorridos diarios',
      });
    }
  }
  // Rediseño WLAN: el valor semanal es el promedio de usuarios por AP de las lecturas diarias.
  if (rediseno && initiatives.some((i) => i.slug === 'rediseno')) {
    const weeks = rediseno.weeklySummary();
    const covered = new Set(weeks.map((w) => w.week));
    merged = merged.filter((r) => !(r.initiative === 'rediseno' && covered.has(r.week)));
    for (const w of weeks) {
      merged.push({
        id: null, auto: true, initiative: 'rediseno', week: w.week, values: { disp_por_ap: w.promedio },
        detail: `Promedio de ${w.lecturas} lecturas en ${w.dias} ${w.dias === 1 ? 'día' : 'días'}. Pico de la semana: ${w.pico} usuarios en un AP.`,
        sede: '', evidenceUrl: null, updatedAt: w.updatedAt, createdBy: null, author: 'Lecturas diarias',
      });
    }
  }
  merged.sort((a, b) => a.week.localeCompare(b.week));
  return { program: seed.program, initiatives, records: merged };
}
const getInitiative = (slug) => {
  const row = db.prepare('SELECT id, slug, def FROM initiatives WHERE slug = ?').get(String(slug));
  if (!row) throw new HttpError(404, 'La iniciativa no existe.');
  return { id: row.id, slug: row.slug, def: JSON.parse(row.def) };
};
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmulas al abrir en Excel
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* ---------- API ---------- */
const canWrite = (u) => u.role === 'admin' || u.role === 'ingeniero';
function requireRole(user, ok, msg = 'Tu usuario no tiene permiso para esta acción.') {
  if (!ok(user)) throw new HttpError(403, msg);
}

async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  if (m !== 'GET' && req.headers['x-requested-with'] !== 'portal') throw new HttpError(403, 'Solicitud no permitida.');

  if (p === '/api/login' && m === 'POST') {
    const body = await readJson(req);
    const username = String(body.username || '').trim().toLowerCase().slice(0, 80);
    const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    const key = clientIp(req) + '|' + username;
    const wait = lockedFor(key);
    if (wait) throw new HttpError(429, `Demasiados intentos. Vuelve a intentar en ${Math.ceil(wait / 60e3)} min.`);
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    // Se calcula siempre el hash para no revelar si el usuario existe.
    const ok = await verifyPassword(password, user || { salt: '00', pass_hash: '00' }) && !!user && !!user.active;
    if (!ok) {
      registerFailure(key);
      audit(user?.id, 'login_fallido', { username });
      throw new HttpError(401, 'Usuario o contraseña incorrectos.');
    }
    attempts.delete(key);
    const token = createSession(user.id);
    audit(user.id, 'login');
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_HOURS * 3600) });
  }

  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Tu sesión terminó. Inicia sesión de nuevo.', 'no_session');

  if (p === '/api/logout' && m === 'POST') {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(readCookie(req, 'sid')));
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (p === '/api/me' && m === 'GET') return send(res, 200, { user: publicUser(user) });

  if (p === '/api/password' && m === 'POST') {
    const body = await readJson(req);
    const full = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!(await verifyPassword(String(body.current || ''), full))) throw new HttpError(400, 'La contraseña actual no es correcta.');
    const next = validatePassword(body.next);
    if (next === body.current) throw new HttpError(400, 'La nueva contraseña debe ser distinta a la actual.');
    const { hash, salt } = await hashPassword(next);
    db.prepare('UPDATE users SET pass_hash = ?, salt = ?, must_change = 0 WHERE id = ?').run(hash, salt, user.id);
    // Cierra las demás sesiones del usuario.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(user.id, sha256(readCookie(req, 'sid')));
    audit(user.id, 'cambio_password');
    return send(res, 200, { ok: true });
  }

  if (user.must_change) throw new HttpError(403, 'Debes cambiar tu contraseña antes de continuar.', 'must_change');

  if (p === '/api/data' && m === 'GET') return send(res, 200, loadData());

  if (p === '/api/export.csv' && m === 'GET') {
    const data = loadData();
    const rows = [['Iniciativa', 'Semana (lunes)', 'Indicador', 'Valor', 'Sede', 'Detalle', 'Evidencia', 'Capturado por', 'Actualizado']];
    for (const r of data.records) {
      const it = data.initiatives.find((i) => i.slug === r.initiative);
      for (const f of it.fields) {
        if (r.values[f.key] === undefined) continue;
        rows.push([it.name, r.week, f.label, r.values[f.key], r.sede, r.detail, r.evidenceUrl, r.author, r.updatedAt]);
      }
    }
    return send(res, 200, '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="avances-nps-wlan.csv"',
    });
  }

  if (p === '/api/records' && m === 'POST') {
    requireRole(user, canWrite, 'Tu usuario es de consulta: no puede capturar avances.');
    const body = await readJson(req);
    const it = getInitiative(body.initiative);
    if (it.slug === 'recorridos') throw new HttpError(400, 'Los recorridos proactivos ahora se capturan por día en la sección Recorridos.');
    if (it.slug === 'rediseno') throw new HttpError(400, 'El rediseño WLAN ahora se captura por día dentro de su tablero.');
    if (!isDate(body.week)) throw new HttpError(400, 'Selecciona una fecha válida para la semana.');
    const week = mondayOf(body.week);
    if (week > mondayOf(new Date().toISOString().slice(0, 10))) throw new HttpError(400, 'No se pueden capturar semanas futuras.');
    if (week < '2020-01-01') throw new HttpError(400, 'La fecha es demasiado antigua.');
    const values = validateValues(it.def.fields, body.values);
    const detail = str(body.detail, 2000, 'Detalle', { required: true, min: 20 });
    const sede = str(body.sede, 200, 'Sede');
    const evidence = str(body.evidenceUrl, 500, 'Enlace de evidencia');
    if (evidence && !/^https?:\/\/[^\s]+$/i.test(evidence)) throw new HttpError(400, 'El enlace de evidencia debe iniciar con http:// o https://');
    const prev = db.prepare('SELECT * FROM records WHERE initiative_id = ? AND week_start = ?').get(it.id, week);
    if (prev) {
      db.prepare('UPDATE records SET vals = ?, detail = ?, sede = ?, evidence_url = ?, updated_by = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(values), detail, sede, evidence, user.id, now(), prev.id);
      audit(user.id, 'registro_actualizado', { initiative: it.slug, week, antes: { values: JSON.parse(prev.vals), detail: prev.detail }, despues: { values, detail } });
    } else {
      db.prepare(`INSERT INTO records (initiative_id, week_start, vals, detail, sede, evidence_url, created_by, created_at, updated_by, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(it.id, week, JSON.stringify(values), detail, sede, evidence, user.id, now(), user.id, now());
      audit(user.id, 'registro_creado', { initiative: it.slug, week, values });
    }
    return send(res, 200, { ok: true, week, replaced: !!prev });
  }

  let mm;
  if ((mm = p.match(/^\/api\/records\/(\d+)$/)) && m === 'DELETE') {
    const rec = db.prepare('SELECT * FROM records WHERE id = ?').get(Number(mm[1]));
    if (!rec) throw new HttpError(404, 'El registro no existe.');
    requireRole(user, (u) => u.role === 'admin' || (u.role === 'ingeniero' && rec.created_by === u.id),
      'Solo quien capturó el registro o un administrador puede eliminarlo.');
    db.prepare('DELETE FROM records WHERE id = ?').run(rec.id);
    audit(user.id, 'registro_eliminado', { week: rec.week_start, values: JSON.parse(rec.vals), detail: rec.detail });
    return send(res, 200, { ok: true });
  }

  if ((mm = p.match(/^\/api\/initiatives\/([a-z0-9_-]+)\/kpis\/([a-z0-9_]+)$/)) && m === 'PUT') {
    requireRole(user, (u) => u.role === 'admin');
    const body = await readJson(req);
    const it = getInitiative(mm[1]);
    const kpi = it.def.kpis.find((k) => k.key === mm[2]);
    if (!kpi) throw new HttpError(404, 'El indicador no existe.');
    const num = (v, label) => {
      if (v === null || v === '' || v === undefined) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new HttpError(400, `${label}: debe ser un número válido.`);
      return n;
    };
    const before = { baseline: kpi.baseline, target: kpi.target };
    kpi.baseline = num(body.baseline, 'Métrica inicial');
    kpi.target = num(body.target, 'Métrica objetivo');
    if (kpi.target !== null && !kpi.op) kpi.op = kpi.dir === 'down' ? '<=' : '>=';
    db.prepare('UPDATE initiatives SET def = ? WHERE id = ?').run(JSON.stringify(it.def), it.id);
    audit(user.id, 'metas_actualizadas', { initiative: it.slug, kpi: kpi.key, antes: before, despues: { baseline: kpi.baseline, target: kpi.target } });
    return send(res, 200, { ok: true });
  }

  if (p === '/api/milestones' && m === 'POST') {
    requireRole(user, canWrite);
    const body = await readJson(req);
    const it = getInitiative(body.initiative);
    if (!isDate(body.date)) throw new HttpError(400, 'Selecciona la fecha del hito.');
    const text = str(body.text, 400, 'Descripción del hito', { required: true, min: 5 });
    db.prepare('INSERT INTO milestones (initiative_id, date, text, sort, created_by) VALUES (?,?,?,?,?)').run(it.id, body.date, text, 0, user.id);
    audit(user.id, 'hito_creado', { initiative: it.slug, date: body.date, text });
    return send(res, 200, { ok: true });
  }
  if ((mm = p.match(/^\/api\/milestones\/(\d+)$/)) && m === 'DELETE') {
    const ms = db.prepare('SELECT * FROM milestones WHERE id = ?').get(Number(mm[1]));
    if (!ms) throw new HttpError(404, 'El hito no existe.');
    requireRole(user, (u) => u.role === 'admin' || (u.role === 'ingeniero' && ms.created_by === u.id),
      'Solo quien registró el hito o un administrador puede eliminarlo.');
    db.prepare('DELETE FROM milestones WHERE id = ?').run(ms.id);
    audit(user.id, 'hito_eliminado', { text: ms.text });
    return send(res, 200, { ok: true });
  }

  if (p === '/api/users' && m === 'GET') {
    requireRole(user, (u) => u.role === 'admin');
    return send(res, 200, { users: db.prepare(`SELECT id, username, name, role, active, must_change AS mustChange, created_at AS createdAt
      FROM users ORDER BY active DESC, name`).all() });
  }
  if (p === '/api/users' && m === 'POST') {
    requireRole(user, (u) => u.role === 'admin');
    const body = await readJson(req);
    const username = (str(body.username, 40, 'Usuario', { required: true, min: 3 }) || '').toLowerCase();
    if (!/^[a-z0-9._@-]{3,40}$/.test(username)) throw new HttpError(400, 'Usuario: usa solo letras, números, punto, guion o @ (3 a 40 caracteres).');
    const name = str(body.name, 80, 'Nombre', { required: true, min: 2 });
    if (!ROLES.includes(body.role)) throw new HttpError(400, 'Selecciona un rol válido.');
    const password = validatePassword(body.password);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Ya existe un usuario con ese nombre de usuario.');
    const { hash, salt } = await hashPassword(password);
    db.prepare('INSERT INTO users (username, name, role, pass_hash, salt, must_change, created_at) VALUES (?,?,?,?,?,1,?)')
      .run(username, name, body.role, hash, salt, now());
    audit(user.id, 'usuario_creado', { username, role: body.role });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/users/bulk' && m === 'POST') {
    requireRole(user, (u) => u.role === 'admin');
    const body = await readJson(req);
    if (typeof body.csv !== 'string' || !body.csv.trim()) throw new HttpError(400, 'Pega la lista de usuarios.');
    const roleOf = { admin: 'admin', administrador: 'admin', ingeniero: 'ingeniero', consulta: 'consulta' };
    const lines = body.csv.replace(/^\ufeff/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 200) throw new HttpError(400, 'Máximo 200 usuarios por carga.');
    const result = { created: 0, skipped: [], errors: [] };
    for (const [i, line] of lines.entries()) {
      const [uRaw, name, roleRaw, password] = line.split(/[,;\t]/).map((c) => c.trim());
      if (i === 0 && (uRaw || '').toLowerCase() === 'usuario') continue;
      const username = (uRaw || '').toLowerCase();
      const role = roleOf[(roleRaw || '').toLowerCase()];
      const problem = !/^[a-z0-9._@-]{3,40}$/.test(username) ? 'usuario no válido'
        : !name || name.length > 80 ? 'falta el nombre' : !role ? 'rol no válido'
        : typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 200 ? `la contraseña debe tener al menos ${MIN_PASSWORD} caracteres` : null;
      if (problem) { result.errors.push(`Línea ${i + 1} (${uRaw || '?'}): ${problem}`); continue; }
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) { result.skipped.push(username); continue; }
      const { hash, salt } = await hashPassword(password);
      db.prepare('INSERT INTO users (username, name, role, pass_hash, salt, must_change, created_at) VALUES (?,?,?,?,?,1,?)')
        .run(username, name, role, hash, salt, now());
      result.created += 1;
    }
    audit(user.id, 'usuarios_carga_masiva', { creados: result.created, omitidos: result.skipped.length, errores: result.errors.length });
    return send(res, 200, result);
  }
  if ((mm = p.match(/^\/api\/users\/(\d+)$/)) && m === 'PUT') {
    requireRole(user, (u) => u.role === 'admin');
    const body = await readJson(req);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(mm[1]));
    if (!target) throw new HttpError(404, 'El usuario no existe.');
    const changes = {};
    if (body.role !== undefined) {
      if (!ROLES.includes(body.role)) throw new HttpError(400, 'Selecciona un rol válido.');
      changes.role = body.role;
    }
    if (body.active !== undefined) changes.active = body.active ? 1 : 0;
    const losesAdmin = target.role === 'admin' && target.active &&
      ((changes.role && changes.role !== 'admin') || changes.active === 0);
    if (losesAdmin) {
      if (target.id === user.id) throw new HttpError(400, 'No puedes quitarte a ti mismo el acceso de administrador.');
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
      if (admins <= 1) throw new HttpError(400, 'Debe quedar al menos un administrador activo.');
    }
    if (changes.role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(changes.role, target.id);
    if (changes.active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(changes.active, target.id);
    if (body.password !== undefined) {
      const { hash, salt } = await hashPassword(validatePassword(body.password));
      db.prepare('UPDATE users SET pass_hash = ?, salt = ?, must_change = 1 WHERE id = ?').run(hash, salt, target.id);
      changes.password = 'restablecida';
    }
    if (changes.active === 0 || changes.password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    audit(user.id, 'usuario_actualizado', { username: target.username, ...changes });
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/respaldo' && m === 'GET') {
    requireRole(user, (u) => u.role === 'admin');
    const tmp = path.join(DATA_DIR, `respaldo-${crypto.randomBytes(6).toString('hex')}.db`);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(tmp); fs.rmSync(tmp, { force: true });
    audit(user.id, 'respaldo_descargado');
    return send(res, 200, buf, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="portal-nps-respaldo-${new Date().toISOString().slice(0, 10)}.db"` });
  }
  if (await recorridos.handle(req, res, url, user)) return;
  if (await rediseno.handle(req, res, url, user)) return;
  throw new HttpError(404, 'Ruta no encontrada.');
}

const recorridos = initRecorridos({ db, HttpError, send, readJson, audit, now, DATA_DIR });
const rediseno = initRediseno({ db, HttpError, send, readJson, audit, now, DATA_DIR });

/* ---------- servidor ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');

    if (p === '/' || p === '/login') {
      const user = currentUser(req);
      if (p === '/' && !user) { res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' }); return res.end(); }
      if (p === '/login' && user) { res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' }); return res.end(); }
      return sendFile(res, path.join(PUBLIC_DIR, p === '/' ? 'app.html' : 'login.html'));
    }
    if (p === '/healthz') return send(res, 200, { ok: true });

    const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(p)));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || path.extname(file) === '.html') return send(res, 404, 'No encontrado');
    return sendFile(res, file);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code, ...(err.extra || {}) });
    if (err instanceof URIError) return send(res, 400, 'Solicitud no válida');
    console.error(err);
    return send(res, 500, { error: 'Ocurrió un error en el servidor. Intenta de nuevo.' });
  }
});

(async () => {
  seedDatabase();
  await ensureAdmin();
  server.listen(PORT, HOST, () => console.log(`Portal NPS · WLAN disponible en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
})();
