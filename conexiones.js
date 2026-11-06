'use strict';
/*
 * Monitoreo proactivo de indicadores clave 2.0: conexiones diarias a BBVA_GLOBAL y BBVA por sede, con el universo
 * en investigación (fallidos que no son ID Authentication 12303) atendido caso por caso.
 * Tablas nuevas; no modifica las existentes.
 */
const C = require('./public/js/conexiones-comun.js');
const { readXlsx } = require('./xlsx-lite.js');

module.exports = function init(ctx) {
  const { db, HttpError, send, readJson, audit, now } = ctx;

  db.exec(`
    CREATE TABLE IF NOT EXISTS cx_cargas (
      id INTEGER PRIMARY KEY, ts TEXT NOT NULL, user_id INTEGER REFERENCES users(id), tipo TEXT NOT NULL, archivo TEXT, resumen TEXT
    );
    CREATE TABLE IF NOT EXISTS cx_lecturas (
      id INTEGER PRIMARY KEY, sede TEXT NOT NULL, fecha TEXT NOT NULL, ssid TEXT NOT NULL,
      dispositivos INTEGER NOT NULL, exitosos INTEGER NOT NULL, fallidos INTEGER NOT NULL, auth12303 INTEGER NOT NULL,
      carga_id INTEGER REFERENCES cx_cargas(id), created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL, UNIQUE (sede, fecha, ssid)
    );
    CREATE TABLE IF NOT EXISTS cx_casos (
      id INTEGER PRIMARY KEY, sede TEXT NOT NULL, fecha TEXT NOT NULL, ssid TEXT, username TEXT, nombre TEXT, dispositivo TEXT, ap TEXT,
      causa TEXT, codigo TEXT, estado TEXT NOT NULL, accion TEXT, comentario TEXT, ingeniero_id INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cx_casos_hist (
      id INTEGER PRIMARY KEY, caso_id INTEGER NOT NULL REFERENCES cx_casos(id) ON DELETE CASCADE, ts TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id), estado TEXT, nota TEXT
    );
  `);

  /** Crea la iniciativa si no existe y deja el orden pedido: esta primero y Monitoreo (1.0) al final. */
  function ensure() {
    if (!db.prepare('SELECT COUNT(*) AS n FROM initiatives').get().n) return;
    const cur = db.prepare("SELECT id, def FROM initiatives WHERE slug = 'conexiones'").get();
    if (cur) {
      // eje de la gráfica acercado (88 % a 100 %) para que se note la mejora semana a semana
      const def = JSON.parse(cur.def); const k = (def.kpis || []).find((x) => x.key === 'exitosas');
      if (k && k.yMin === undefined) { k.yMin = 88; db.prepare('UPDATE initiatives SET def = ? WHERE id = ?').run(JSON.stringify(def), cur.id); }
    }
    if (!cur) {
      db.prepare('INSERT INTO initiatives (slug, sort, def) VALUES (?,?,?)').run('conexiones', -1, JSON.stringify(C.INICIATIVA));
      audit(null, 'iniciativa_creada', { slug: 'conexiones' });
      // orden: 2.0 primero, después las demás en su orden actual y Monitoreo proactivo (1.0) al final
      const rows = db.prepare("SELECT id, slug FROM initiatives WHERE slug <> 'conexiones' ORDER BY sort, id").all();
      const order = ['conexiones', ...rows.filter((r) => r.slug !== 'monitoreo').map((r) => r.slug), 'monitoreo'];
      const up = db.prepare('UPDATE initiatives SET sort = ? WHERE slug = ?');
      order.forEach((slug, i) => up.run(i, slug));
      audit(null, 'iniciativas_reordenadas', { orden: order });
    }
  }

  const canWrite = (u) => u.role === 'admin' || u.role === 'ingeniero';
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const today = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10); // hora del centro de México
  const txt = (v, max) => { const t = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); return t ? t.slice(0, max) : null; };
  const need = (v, msg) => { if (v === null || v === undefined || v === '') throw new HttpError(400, msg); return v; };

  /** Normaliza una lectura diaria; devuelve los avisos de corrección. */
  function lectura(r, where) {
    const avisos = [];
    const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const sede = C.SEDE[r.sede] ? r.sede : null;
    if (!sede) throw new HttpError(400, `${where}: la sede no es válida.`);
    if (!isDate(r.fecha) || r.fecha > today()) throw new HttpError(400, `${where}: la fecha no es válida o es futura.`);
    const ssid = C.SSIDS.includes(r.ssid) ? r.ssid : null;
    if (!ssid) throw new HttpError(400, `${where}: el SSID debe ser BBVA_GLOBAL o BBVA.`);
    let disp = n(r.dispositivos), ok = n(r.exitosos), fail = n(r.fallidos), auth = n(r.auth12303) ?? 0;
    for (const [k, v] of [['dispositivos', disp], ['exitosos', ok], ['fallidos', fail], ['ID Authentication 12303', auth]]) {
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > 10000000)) throw new HttpError(400, `${where}: ${k} debe ser un número entero.`);
    }
    if (disp === null) { if (ok === null || fail === null) throw new HttpError(400, `${where}: escribe el total de dispositivos.`); disp = ok + fail; }
    if (ok === null && fail === null) throw new HttpError(400, `${where}: escribe los exitosos o los fallidos.`);
    if (ok === null) ok = disp - fail;
    if (fail === null) fail = disp - ok;
    if (ok + fail !== disp) { avisos.push(`${where}: exitosos (${ok}) + fallidos (${fail}) no suman el total (${disp}); se tomaron fallidos = total − exitosos (${disp - ok}).`); fail = disp - ok; }
    if (ok > disp || fail < 0) throw new HttpError(400, `${where}: los exitosos no pueden ser más que el total de dispositivos.`);
    if (auth > fail) throw new HttpError(400, `${where}: las fallas ID Authentication 12303 (${auth}) no pueden ser más que los fallidos (${fail}).`);
    return { row: { sede, fecha: r.fecha, ssid, dispositivos: disp, exitosos: ok, fallidos: fail, auth12303: auth }, avisos };
  }

  /** Guarda (o compara, si commit = false) un lote de lecturas; nuevas, que cambian y sin cambio. */
  function aplicar(rows, user, tipo, archivo, commit) {
    const get = db.prepare('SELECT * FROM cx_lecturas WHERE sede = ? AND fecha = ? AND ssid = ?');
    const res = { nuevas: 0, actualizadas: 0, sinCambio: 0, cambios: [] };
    const plan = rows.map((r) => {
      const prev = get.get(r.sede, r.fecha, r.ssid);
      if (!prev) { res.nuevas += 1; return { r, op: 'ins' }; }
      if (['dispositivos', 'exitosos', 'fallidos', 'auth12303'].every((k) => prev[k] === r[k])) { res.sinCambio += 1; return { r, op: null }; }
      res.actualizadas += 1;
      if (res.cambios.length < 40) res.cambios.push(`${C.SEDE[r.sede].name} · ${r.ssid} · ${r.fecha}: ${prev.exitosos}/${prev.dispositivos} → ${r.exitosos}/${r.dispositivos}`);
      return { r, op: 'upd', prev };
    });
    if (!commit || (!res.nuevas && !res.actualizadas)) return res;
    const ts = now();
    db.exec('BEGIN');
    try {
      const carga = Number(db.prepare('INSERT INTO cx_cargas (ts, user_id, tipo, archivo, resumen) VALUES (?,?,?,?,?)').run(ts, user.id, tipo, archivo, JSON.stringify({ nuevas: res.nuevas, actualizadas: res.actualizadas })).lastInsertRowid);
      const ins = db.prepare('INSERT INTO cx_lecturas (sede, fecha, ssid, dispositivos, exitosos, fallidos, auth12303, carga_id, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
      const upd = db.prepare('UPDATE cx_lecturas SET dispositivos = ?, exitosos = ?, fallidos = ?, auth12303 = ?, carga_id = ?, updated_by = ?, updated_at = ? WHERE id = ?');
      for (const p of plan) {
        if (p.op === 'ins') ins.run(p.r.sede, p.r.fecha, p.r.ssid, p.r.dispositivos, p.r.exitosos, p.r.fallidos, p.r.auth12303, carga, user.id, ts, user.id, ts);
        if (p.op === 'upd') upd.run(p.r.dispositivos, p.r.exitosos, p.r.fallidos, p.r.auth12303, carga, user.id, ts, p.prev.id);
      }
      db.exec('COMMIT');
      res.carga = carga;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(user.id, 'conexiones_carga', { tipo, archivo, nuevas: res.nuevas, actualizadas: res.actualizadas });
    return res;
  }

  /** Lee el Excel con el formato del ejercicio: una hoja por sede, título con el SSID, un renglón por día. */
  function parseExcel(buf) {
    const { sheets, date1904 } = readXlsx(buf);
    const epoch = Date.UTC(1899, 11, 30) + (date1904 ? 1462 * 864e5 : 0);
    const out = { hojas: [], filas: [], avisos: [], errores: [] };
    const fechaDe = (v) => {
      if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(epoch + Math.round(v * 864e5)).toISOString().slice(0, 10);
      const s = String(v || '').trim();
      let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      return null;
    };
    for (const sh of sheets) {
      const get = (r, c) => { const x = sh.cells.get(`${r},${c}`); return x ? x.v : undefined; };
      // encabezados: el renglón que tiene "Fecha" y "Dispositivos"
      let hr = null; const head = [];
      for (let r = 1; r <= Math.min(sh.maxRow, 12) && !hr; r++) {
        const cells = []; for (let c = 1; c <= Math.min(sh.maxCol, 30); c++) cells.push(C.plain(get(r, c) || '').replace(/\s+/g, ' ').trim());
        if (cells.some((x) => x === 'fecha') && cells.some((x) => /dispositivos/.test(x))) { hr = r; head.push(...cells); }
      }
      if (!hr) { out.hojas.push({ hoja: sh.name, filas: 0, nota: 'No tiene la tabla de conexiones (Fecha, Total dispositivos…); se omitió.' }); continue; }
      const col = (re) => { const i = head.findIndex((h) => re.test(h)); return i < 0 ? null : i + 1; };
      const cF = col(/^fecha$/), cD = col(/total dispositivos/), cOk = col(/^total exitosos/), cFail = col(/^total fallidos/), cAuth = col(/^id auth\w* 12303$/) || col(/12303/);
      let titulo = ''; for (let r = 1; r < hr; r++) for (let c = 1; c <= 3; c++) if (typeof get(r, c) === 'string') titulo += ' ' + get(r, c);
      const sede = C.sedeDe(sh.name) || C.sedeDe(titulo);
      const ssid = C.ssidDe(titulo) || C.ssidDe(sh.name) || 'BBVA_GLOBAL';
      if (!sede) { out.hojas.push({ hoja: sh.name, filas: 0, nota: 'El nombre de la hoja no corresponde a una sede de la iniciativa; se omitió.' }); continue; }
      if (!cD || (!cOk && !cFail)) { out.hojas.push({ hoja: sh.name, filas: 0, nota: 'Faltan las columnas de total de dispositivos y exitosos o fallidos.' }); continue; }
      let n = 0;
      for (let r = hr + 1; r <= sh.maxRow; r++) {
        const fv = get(r, cF);
        if (fv === undefined) continue;
        if (typeof fv === 'string' && /promedio|total/i.test(fv)) continue; // renglones de resumen: el portal calcula los suyos
        const fecha = fechaDe(fv);
        if (!fecha) continue;
        const where = `${sh.name}, fila ${r}`;
        const v = (c) => { const x = c ? get(r, c) : undefined; return typeof x === 'number' ? Math.round(x) : x === undefined ? null : Number(x); };
        try {
          const { row, avisos } = lectura({ sede: sede.key, fecha, ssid, dispositivos: v(cD), exitosos: v(cOk), fallidos: v(cFail), auth12303: cAuth ? v(cAuth) : 0 }, where);
          out.filas.push(row); out.avisos.push(...avisos); n += 1;
        } catch (e) { out.errores.push(e.message); }
      }
      out.hojas.push({ hoja: sh.name, sede: sede.name, ssid, filas: n, nota: cAuth ? '' : 'Sin columna ID Authentication 12303: todos los fallidos quedan en investigación.' });
    }
    // un mismo día, sede y SSID repetido dentro del archivo: queda el último
    const seen = new Map(); out.filas.forEach((f) => seen.set(`${f.sede}|${f.fecha}|${f.ssid}`, f));
    if (seen.size < out.filas.length) out.avisos.push(`${out.filas.length - seen.size} renglones repetidos (misma sede, día y SSID): se tomó el último.`);
    out.filas = [...seen.values()];
    return out;
  }

  function datos() {
    const lect = db.prepare('SELECT id, sede, fecha, ssid, dispositivos, exitosos, fallidos, auth12303, carga_id AS cargaId FROM cx_lecturas ORDER BY fecha DESC, sede, ssid').all();
    const cargas = db.prepare('SELECT c.id, c.ts, c.tipo, c.archivo, c.resumen, c.user_id AS userId, u.name AS user, (SELECT COUNT(*) FROM cx_lecturas l WHERE l.carga_id = c.id) AS vigentes FROM cx_cargas c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 40').all()
      .map((c) => ({ ...c, resumen: JSON.parse(c.resumen || '{}') }));
    const hist = db.prepare('SELECT h.caso_id, h.ts, h.estado, h.nota, u.name AS user FROM cx_casos_hist h LEFT JOIN users u ON u.id = h.user_id ORDER BY h.id').all();
    const casos = db.prepare('SELECT c.*, i.name AS ingeniero FROM cx_casos c LEFT JOIN users i ON i.id = c.ingeniero_id ORDER BY c.fecha DESC, c.id DESC').all()
      .map((c) => ({ id: c.id, sede: c.sede, fecha: c.fecha, ssid: c.ssid, username: c.username, nombre: c.nombre, dispositivo: c.dispositivo, ap: c.ap, causa: c.causa, codigo: c.codigo,
        estado: c.estado, accion: c.accion, comentario: c.comentario, ingenieroId: c.ingeniero_id, ingeniero: c.ingeniero, createdBy: c.created_by, updatedAt: c.updated_at,
        historial: hist.filter((h) => h.caso_id === c.id).map((h) => ({ ts: h.ts, estado: h.estado, nota: h.nota, user: h.user || 'Sistema' })) }));
    return { hoy: today(), lecturas: lect, cargas, casos, ingenieros: db.prepare("SELECT id, name FROM users WHERE role IN ('admin','ingeniero') AND active = 1 ORDER BY name").all() };
  }

  function weeklySummary() {
    const rows = db.prepare('SELECT sede, fecha, dispositivos, exitosos, fallidos, auth12303, updated_at FROM cx_lecturas').all();
    const by = new Map();
    for (const r of rows) { const w = C.mondayOf(r.fecha); if (!by.has(w)) by.set(w, []); by.get(w).push(r); }
    const casos = db.prepare('SELECT fecha, estado FROM cx_casos').all();
    return [...by.entries()].map(([week, list]) => {
      const t = C.totales(list); const end = C.addDays(week, 6);
      const cs = casos.filter((c) => c.fecha >= week && c.fecha <= end);
      return { week, t, sedes: new Set(list.map((r) => r.sede)).size, casos: cs.length, resueltos: cs.filter((c) => !C.ESTADO[c.estado].abierto).length,
        updatedAt: list.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '') };
    });
  }

  function casoInput(body, user, prev) {
    const sede = C.SEDE[body.sede] ? body.sede : null; if (!sede) throw new HttpError(400, 'Selecciona la sede.');
    const fecha = need(isDate(body.fecha) && body.fecha <= today() ? body.fecha : null, 'Selecciona la fecha (no puede ser futura).');
    const username = txt(body.username, 60), dispositivo = txt(body.dispositivo, 80);
    if (!username && !dispositivo) throw new HttpError(400, 'Escribe el username o la MAC del dispositivo.');
    let ing = prev ? prev.ingeniero_id : user.id;
    if (body.ingenieroId !== undefined && body.ingenieroId !== null && body.ingenieroId !== '' && Number(body.ingenieroId) !== ing) {
      if (user.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede asignar el caso a otro ingeniero.');
      if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role IN ('admin','ingeniero')").get(Number(body.ingenieroId))) throw new HttpError(400, 'El ingeniero seleccionado no existe.');
      ing = Number(body.ingenieroId);
    }
    return { sede, fecha, ssid: C.SSIDS.includes(body.ssid) ? body.ssid : null, username: username ? username.toUpperCase().replace(/\s+/g, '') : null, nombre: txt(body.nombre, 120),
      dispositivo: dispositivo && /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(dispositivo) ? dispositivo.toLowerCase().replace(/-/g, ':') : dispositivo, ap: txt(body.ap, 60), causa: txt(body.causa, 160), codigo: txt(body.codigo, 20),
      estado: C.ESTADO[body.estado] ? body.estado : 'nuevo', accion: txt(body.accion, 2000), comentario: txt(body.comentario, 2000), ingeniero_id: ing };
  }

  const q = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = (res, name, head, rows) => { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' }); res.end('﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n')); return true; };
  const pct = (a, b, d = 2) => (b ? Math.round((a / b) * 100 * 10 ** d) / 10 ** d : '');

  async function handle(req, res, url, user) {
    const p = url.pathname, m = req.method;
    if (!p.startsWith('/api/conexiones')) return false;
    let mm;
    if (p === '/api/conexiones/datos' && m === 'GET') return send(res, 200, datos()), true;

    if (p === '/api/conexiones/lecturas' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede capturar lecturas.');
      const body = await readJson(req);
      const list = Array.isArray(body.lecturas) ? body.lecturas.slice(0, 40) : [];
      if (!list.length) throw new HttpError(400, 'Captura al menos un SSID.');
      const rows = []; const avisos = [];
      list.forEach((r) => { const x = lectura({ ...r, sede: body.sede, fecha: body.fecha }, `${r.ssid || 'SSID'}`); rows.push(x.row); avisos.push(...x.avisos); });
      const r = aplicar(rows, user, 'manual', null, true);
      return send(res, 200, { ...r, avisos }), true;
    }

    if (p === '/api/conexiones/importar' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede cargar información.');
      const buf = await new Promise((resolve, reject) => { let size = 0; const ch = []; req.on('data', (c) => { size += c.length; if (size > 15 * 1024 * 1024) { reject(new HttpError(413, 'El archivo es demasiado grande (máximo 15 MB).')); req.destroy(); } else ch.push(c); }); req.on('end', () => resolve(Buffer.concat(ch))); req.on('error', reject); });
      let parsed; try { parsed = parseExcel(buf); } catch (e) { throw new HttpError(400, e.message || 'No se pudo leer el archivo.'); }
      if (!parsed.filas.length) return send(res, 200, { hojas: parsed.hojas, avisos: parsed.avisos, errores: parsed.errores, nuevas: 0, actualizadas: 0, sinCambio: 0, cambios: [], guardado: false }), true;
      const commit = url.searchParams.get('modo') === 'guardar';
      if (commit && parsed.errores.length) throw new HttpError(400, 'Corrige los errores del archivo antes de guardar.');
      const r = aplicar(parsed.filas, user, 'excel', txt(url.searchParams.get('nombre'), 120), commit);
      return send(res, 200, { ...r, hojas: parsed.hojas, avisos: parsed.avisos, errores: parsed.errores, guardado: commit }), true;
    }

    if ((mm = p.match(/^\/api\/conexiones\/cargas\/(\d+)$/)) && m === 'DELETE') {
      const c = db.prepare('SELECT * FROM cx_cargas WHERE id = ?').get(Number(mm[1]));
      if (!c) throw new HttpError(404, 'La carga no existe.');
      if (!(user.role === 'admin' || (user.role === 'ingeniero' && c.user_id === user.id && c.tipo === 'manual'))) throw new HttpError(403, 'Solo un administrador puede deshacer cargas de Excel o de otras personas.');
      const r = db.prepare('DELETE FROM cx_lecturas WHERE carga_id = ?').run(c.id);
      const resumen = { ...JSON.parse(c.resumen || '{}'), deshecha: { por: user.name || user.username, ts: now(), lecturas: Number(r.changes) } };
      db.prepare('UPDATE cx_cargas SET resumen = ? WHERE id = ?').run(JSON.stringify(resumen), c.id);
      audit(user.id, 'conexiones_carga_deshecha', { carga: c.id, lecturas: Number(r.changes) });
      return send(res, 200, { lecturas: Number(r.changes) }), true;
    }

    if (p === '/api/conexiones/casos' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede registrar casos.');
      const row = casoInput(await readJson(req), user, null);
      const ts = now();
      const id = Number(db.prepare(`INSERT INTO cx_casos (sede, fecha, ssid, username, nombre, dispositivo, ap, causa, codigo, estado, accion, comentario, ingeniero_id, created_by, created_at, updated_by, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.sede, row.fecha, row.ssid, row.username, row.nombre, row.dispositivo, row.ap, row.causa, row.codigo, row.estado, row.accion, row.comentario, row.ingeniero_id, user.id, ts, user.id, ts).lastInsertRowid);
      db.prepare('INSERT INTO cx_casos_hist (caso_id, ts, user_id, estado, nota) VALUES (?,?,?,?,?)').run(id, ts, user.id, row.estado, row.comentario || 'Caso registrado');
      audit(user.id, 'conexiones_caso_registrado', { id, sede: row.sede });
      return send(res, 200, { id }), true;
    }
    if ((mm = p.match(/^\/api\/conexiones\/casos\/(\d+)$/))) {
      const c = db.prepare('SELECT * FROM cx_casos WHERE id = ?').get(Number(mm[1]));
      if (!c) throw new HttpError(404, 'El caso no existe.');
      if (m === 'PUT') {
        if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede actualizar casos.');
        const body = await readJson(req);
        const estado = C.ESTADO[body.estado] ? body.estado : c.estado;
        const nota = txt(body.nota, 2000);
        const causa = body.causa !== undefined ? txt(body.causa, 160) : c.causa;
        const accion = body.accion !== undefined ? txt(body.accion, 2000) : c.accion;
        let ing = c.ingeniero_id;
        if (body.ingenieroId !== undefined && Number(body.ingenieroId || 0) !== (c.ingeniero_id || 0)) {
          const to = body.ingenieroId ? Number(body.ingenieroId) : null;
          if (user.role !== 'admin' && !(to === user.id && !c.ingeniero_id)) throw new HttpError(403, 'Solo un administrador puede reasignar casos. Puedes tomar los que no tienen ingeniero.');
          ing = to;
        }
        if (estado === c.estado && !nota && causa === c.causa && accion === c.accion && ing === c.ingeniero_id) throw new HttpError(400, 'No hay cambios que guardar.');
        const ts = now();
        db.prepare('UPDATE cx_casos SET estado = ?, causa = ?, accion = ?, ingeniero_id = ?, comentario = COALESCE(?, comentario), updated_by = ?, updated_at = ? WHERE id = ?').run(estado, causa, accion, ing, nota, user.id, ts, c.id);
        db.prepare('INSERT INTO cx_casos_hist (caso_id, ts, user_id, estado, nota) VALUES (?,?,?,?,?)').run(c.id, ts, user.id, estado !== c.estado ? estado : null, nota || (ing !== c.ingeniero_id ? 'Caso reasignado' : null));
        audit(user.id, 'conexiones_caso_seguimiento', { id: c.id, antes: c.estado, despues: estado });
        return send(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE') {
        if (!(user.role === 'admin' || (user.role === 'ingeniero' && c.created_by === user.id))) throw new HttpError(403, 'Solo quien registró el caso o un administrador puede eliminarlo.');
        db.prepare('DELETE FROM cx_casos_hist WHERE caso_id = ?').run(c.id);
        db.prepare('DELETE FROM cx_casos WHERE id = ?').run(c.id);
        audit(user.id, 'conexiones_caso_eliminado', { id: c.id });
        return send(res, 200, { ok: true }), true;
      }
    }

    if ((mm = p.match(/^\/api\/conexiones\/export\/(lecturas|semanal|casos)\.csv$/)) && m === 'GET') {
      const D = datos();
      if (mm[1] === 'lecturas') return csv(res, 'conexiones-diarias.csv', ['Fecha', 'Sede', 'SSID', 'Total dispositivos', 'Total exitosos', '% exitosos', 'Total fallidos', '% fallidos', 'ID Authentication 12303', '% 12303', 'En investigación', '% en investigación'],
        D.lecturas.slice().reverse().map((r) => [r.fecha, C.SEDE[r.sede].name, r.ssid, r.dispositivos, r.exitosos, pct(r.exitosos, r.dispositivos), r.fallidos, pct(r.fallidos, r.dispositivos), r.auth12303, pct(r.auth12303, r.dispositivos), r.fallidos - r.auth12303, pct(r.fallidos - r.auth12303, r.dispositivos)]));
      if (mm[1] === 'semanal') {
        const rows = [];
        const weeks = [...new Set(D.lecturas.map((r) => C.mondayOf(r.fecha)))].sort();
        for (const w of weeks) {
          const l = D.lecturas.filter((r) => C.mondayOf(r.fecha) === w);
          for (const s of [null, ...C.SEDES]) {
            const ls = s ? l.filter((r) => r.sede === s.key) : l; if (!ls.length) continue;
            const t = C.totales(ls);
            rows.push([w, C.addDays(w, 6), s ? s.name : 'Todas las sedes', t.dias, t.disp, t.ok, pct(t.ok, t.disp), t.auth, pct(t.auth, t.disp), t.inv, pct(t.inv, t.disp), Math.round((pct(t.ok, t.disp) - C.META.inicial) * 100) / 100]);
          }
        }
        return csv(res, 'conexiones-semanal.csv', ['Semana (lunes)', 'Al', 'Sede', 'Lecturas', 'Dispositivos', 'Exitosos', '% exitosos (ponderado)', 'ID Authentication 12303', '% 12303', 'En investigación', '% en investigación', 'Puntos vs 91.3 %'], rows);
      }
      return csv(res, 'conexiones-casos-en-investigacion.csv', ['Fecha', 'Sede', 'SSID', 'Username', 'Nombre', 'MAC / dispositivo', 'AP', 'Causa', 'Código de falla', 'Estado', 'Acción', 'Último comentario', 'Ingeniero', 'Última actualización'],
        D.casos.map((c) => [c.fecha, C.SEDE[c.sede].name, c.ssid, c.username, c.nombre, c.dispositivo, c.ap, c.causa, c.codigo, C.ESTADO[c.estado].label, c.accion, c.comentario, c.ingeniero, c.updatedAt ? c.updatedAt.slice(0, 10) : '']));
    }
    throw new HttpError(404, 'Ruta no encontrada.');
  }

  return { handle, weeklySummary, ensure };
};
