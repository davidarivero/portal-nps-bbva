'use strict';
/*
 * Monitoreo proactivo de indicadores clave: un caso por usuario o dispositivo con intentos fallidos detectados en Meraki,
 * con su contacto y seguimiento. Los indicadores semanales de la iniciativa se calculan solos a partir de los casos.
 * Tablas nuevas; no modifica las existentes.
 */
const C = require('./public/js/monitoreo-comun.js');
const { readXlsx } = require('./xlsx-lite.js');

module.exports = function init(ctx) {
  const { db, HttpError, send, readJson, audit, now } = ctx;

  db.exec(`
    CREATE TABLE IF NOT EXISTS mon_casos (
      id INTEGER PRIMARY KEY, sede_id INTEGER NOT NULL REFERENCES sedes(id), fecha TEXT NOT NULL,
      username TEXT, nombre TEXT, dispositivo TEXT, falla TEXT, intentos INTEGER, ssid TEXT, ap TEXT, evento TEXT,
      estado TEXT NOT NULL DEFAULT 'pendiente', comentario TEXT, ingeniero_id INTEGER REFERENCES users(id), origen TEXT NOT NULL DEFAULT 'portal',
      created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mon_casos_fecha ON mon_casos(fecha);
    CREATE INDEX IF NOT EXISTS mon_casos_disp ON mon_casos(dispositivo);
    CREATE TABLE IF NOT EXISTS mon_seguimiento (
      id INTEGER PRIMARY KEY, caso_id INTEGER NOT NULL REFERENCES mon_casos(id) ON DELETE CASCADE, ts TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id), estado TEXT, nota TEXT
    );
  `);
  // León no participa en el monitoreo (v3.14): si una versión de prueba lo agregó al catálogo, se quita junto con sus casos.
  {
    const leon = db.prepare("SELECT id FROM sedes WHERE key = 'leon' AND name = 'BBVA León'").get();
    if (leon && !db.prepare('SELECT 1 FROM recorridos WHERE sede_id = ?').get(leon.id) && !db.prepare('SELECT 1 FROM pisos WHERE sede_id = ?').get(leon.id)) {
      const ids = db.prepare('SELECT id FROM mon_casos WHERE sede_id = ?').all(leon.id).map((r) => r.id);
      for (const id of ids) { db.prepare('DELETE FROM mon_seguimiento WHERE caso_id = ?').run(id); db.prepare('DELETE FROM mon_casos WHERE id = ?').run(id); }
      db.prepare('DELETE FROM sedes WHERE id = ?').run(leon.id);
      audit(null, 'monitoreo_sede_leon_retirada', { casos: ids.length });
    }
  }
  // Usernames siempre en mayúsculas y sin espacios: evita duplicar al mismo usuario por cómo se escribió.
  db.prepare("UPDATE mon_casos SET username = upper(replace(trim(username), ' ', '')) WHERE username IS NOT NULL AND username <> upper(replace(trim(username), ' ', ''))").run();

  const canWrite = (u) => u.role === 'admin' || u.role === 'ingeniero';
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const mondayOf = (s) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const today = () => new Date().toISOString().slice(0, 10);
  const txt = (v, max) => { const t = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); return t ? t.slice(0, max) : null; };
  const disp = (v) => { const t = txt(v, 80); return t && C.MAC_RE.test(t) ? t.toLowerCase().replace(/-/g, ':') : t; };

  function catalog() {
    return {
      estados: C.ESTADOS,
      // fallas ordenadas de la más recurrente a la menos; después, las del catálogo que aún no aparecen
      fallas: (() => { const f = db.prepare('SELECT falla AS k, COUNT(*) AS n FROM mon_casos WHERE falla IS NOT NULL GROUP BY falla ORDER BY n DESC').all(); return [...f, ...C.FALLAS.filter((x) => !f.some((y) => y.k === x)).map((k) => ({ k, n: 0 }))]; })(),
      usuarios: db.prepare(`SELECT username AS u, (SELECT nombre FROM mon_casos y WHERE y.username = x.username AND y.nombre IS NOT NULL GROUP BY nombre ORDER BY COUNT(*) DESC LIMIT 1) AS nombre, COUNT(*) AS n
        FROM mon_casos x WHERE username IS NOT NULL GROUP BY username ORDER BY n DESC`).all(),
      ssids: [...new Set([...C.SSIDS, ...db.prepare('SELECT DISTINCT ssid FROM mon_casos WHERE ssid IS NOT NULL').all().map((r) => r.ssid)])],
      sedes: db.prepare('SELECT id, name FROM sedes ORDER BY sort, id').all(),
      ingenieros: db.prepare("SELECT id, name FROM users WHERE role IN ('admin','ingeniero') AND active = 1 ORDER BY name").all(),
      aps: db.prepare('SELECT ap, sede_id AS sedeId, COUNT(*) AS n FROM mon_casos WHERE ap IS NOT NULL GROUP BY ap, sede_id ORDER BY n DESC LIMIT 400').all(),
      rango: db.prepare('SELECT MIN(fecha) AS min, MAX(fecha) AS max, COUNT(*) AS n FROM mon_casos').get(),
    };
  }

  function list(q) {
    const hasta = isDate(q.get('hasta')) ? q.get('hasta') : today();
    const desde = isDate(q.get('desde')) ? q.get('desde') : (() => { const d = new Date(hasta + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 27); return d.toISOString().slice(0, 10); })();
    const casos = db.prepare(`SELECT c.id, c.sede_id AS sedeId, s.name AS sede, c.fecha, c.username, c.nombre, c.dispositivo, c.falla, c.intentos, c.ssid, c.ap, c.evento,
        c.estado, c.comentario, c.ingeniero_id AS ingenieroId, ui.name AS ingeniero, c.origen, c.created_by AS createdBy, c.updated_at AS updatedAt, uu.name AS updatedByName,
        (SELECT COUNT(*) FROM mon_casos x WHERE x.id <> c.id AND ((c.dispositivo IS NOT NULL AND x.dispositivo = c.dispositivo) OR (c.username IS NOT NULL AND lower(x.username) = lower(c.username)))) AS otros
      FROM mon_casos c JOIN sedes s ON s.id = c.sede_id LEFT JOIN users ui ON ui.id = c.ingeniero_id LEFT JOIN users uu ON uu.id = c.updated_by
      WHERE c.fecha BETWEEN ? AND ? ORDER BY c.fecha DESC, c.id DESC`).all(desde, hasta);
    return { desde, hasta, casos };
  }

  function pendientes() {
    return db.prepare(`SELECT c.id, c.sede_id AS sedeId, s.name AS sede, c.fecha, c.username, c.nombre, c.dispositivo, c.falla, c.intentos, c.ssid, c.ap, c.evento,
        c.estado, c.comentario, c.ingeniero_id AS ingenieroId, ui.name AS ingeniero, c.origen, c.created_by AS createdBy, c.updated_at AS updatedAt,
        (SELECT MAX(ts) FROM mon_seguimiento h WHERE h.caso_id = c.id) AS ultimo, (SELECT COUNT(*) FROM mon_seguimiento h WHERE h.caso_id = c.id) AS movimientos,
        (SELECT COUNT(*) FROM mon_casos x WHERE x.id <> c.id AND ((c.dispositivo IS NOT NULL AND x.dispositivo = c.dispositivo) OR (c.username IS NOT NULL AND x.username = c.username))) AS otros
      FROM mon_casos c JOIN sedes s ON s.id = c.sede_id LEFT JOIN users ui ON ui.id = c.ingeniero_id
      WHERE c.estado IN ('pendiente', 'sin_respuesta', 'cita') ORDER BY c.fecha, c.id`).all();
  }

  function history(id) {
    return db.prepare(`SELECT h.ts, h.estado, h.nota, COALESCE(u.name, 'Carga histórica') AS user FROM mon_seguimiento h LEFT JOIN users u ON u.id = h.user_id WHERE h.caso_id = ? ORDER BY h.id`).all(id);
  }

  /** Valida un caso que viene del portal. */
  function clean(r, i) {
    const where = `Renglón ${i + 1}`;
    const out = {
      username: C.userKey(C.vacio(r.username)) ? String(C.vacio(r.username)).toUpperCase().replace(/\s+/g, '').slice(0, 60) : null, nombre: txt(C.vacio(r.nombre), 120), dispositivo: disp(C.vacio(r.mac ?? r.dispositivo)),
      falla: txt(r.falla, 160), intentos: r.intentos === '' || r.intentos === null || r.intentos === undefined ? null : Number(r.intentos),
      ssid: txt(r.ssid, 40), ap: txt(r.ap, 60), evento: r.evento ? C.fechaHora(r.evento) : null, comentario: txt(r.comentario, 1000),
      estado: C.ESTADO[r.estado] ? r.estado : C.estadoDe(r.comentario),
    };
    if (!out.dispositivo && !out.username) throw new HttpError(400, `${where}: escribe el username o la MAC del dispositivo.`);
    if (out.intentos !== null && (!Number.isInteger(out.intentos) || out.intentos < 0 || out.intentos > 100000)) throw new HttpError(400, `${where}: los intentos fallidos deben ser un número entero.`);
    if (r.evento && !out.evento) throw new HttpError(400, `${where}: la fecha del último intento no es válida.`);
    return out;
  }

  const ins = () => db.prepare(`INSERT INTO mon_casos (sede_id, fecha, username, nombre, dispositivo, falla, intentos, ssid, ap, evento, estado, comentario, ingeniero_id, origen, created_by, created_at, updated_by, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const logIns = () => db.prepare('INSERT INTO mon_seguimiento (caso_id, ts, user_id, estado, nota) VALUES (?,?,?,?,?)');

  /* ---------- histórico desde el Excel de seguimiento (una sola vez, administrador) ---------- */
  function parseHistorico(buf) {
    const { sheets, date1904 } = readXlsx(buf);
    const epoch = Date.UTC(1899, 11, 30) + (date1904 ? 1462 * 864e5 : 0);
    const xdate = (n) => new Date(epoch + Math.round(n * 864e5)).toISOString().slice(0, 16).replace('Z', '');
    const sedes = db.prepare('SELECT id, name FROM sedes').all().map((s) => ({ ...s, k: C.plain(s.name).replace(/\bbbva\b/g, '').replace(/[^a-z]/g, '') }));
    const sedeDe = (name) => {
      const k = C.plain(name).replace(/\bbbva\b/g, '').replace(/[^a-z]/g, '');
      return sedes.find((s) => s.k && (k.includes(s.k) || s.k.includes(k))) || sedes.find((s) => /polanco/.test(s.k) && /polanco|parques/.test(k)) ||
        sedes.find((s) => /landmark/.test(s.k) && /landmark|gdl/.test(k)) || null;
    };
    const out = { hojas: [], casos: [], avisos: [] };
    for (const sh of sheets) {
      const get = (r, c) => { const x = sh.cells.get(`${r},${c}`); return x ? x.v : undefined; };
      const head = []; for (let c = 1; c <= Math.min(sh.maxCol, 14); c++) head.push(C.plain(get(1, c) || ''));
      const col = (re, from = 0) => { const i = head.findIndex((h, j) => j >= from && re.test(h)); return i < 0 ? null : i + 1; };
      const cFalla = col(/^(log detectado|razon|failure type)$/), cAp = col(/^(ap|access point)$/);
      if (!cFalla || !cAp) { out.hojas.push({ hoja: sh.name, casos: 0, nota: 'No tiene la tabla de seguimiento; se omitió.' }); continue; }
      const sede = sedeDe(sh.name);
      if (!sede) { out.hojas.push({ hoja: sh.name, casos: 0, nota: 'El nombre de la hoja no corresponde a una sede (parece un reporte diario); se omitió para no duplicar casos.' }); continue; }
      const cFecha = col(/^fecha$/), cEvento = col(/^(fecha|last failed attempt.*)$/, (cFecha || 0)), cUser = col(/^username$/), cNom = col(/^nombre$/), cMac = col(/^(mac|name)$/),
        cInt = col(/^(intentos fallidos|failed attempts)$/), cSsid = col(/^ssid$/), cCom = col(/^comentarios?$/);
      let n = 0;
      for (let r = 2; r <= sh.maxRow; r++) {
        const v = (c) => (c ? get(r, c) : undefined);
        if (v(cFalla) === undefined && v(cAp) === undefined && v(cMac) === undefined) continue;
        const ev = typeof v(cEvento) === 'number' ? xdate(v(cEvento)) : C.fechaHora(v(cEvento));
        let fecha = typeof v(cFecha) === 'number' ? xdate(v(cFecha)).slice(0, 10) : C.fechaDe(v(cFecha));
        const evDay = ev ? ev.slice(0, 10) : null;
        // La fecha de revisión no puede ser posterior a hoy ni muy lejana al intento fallido: se toma la del intento y se avisa.
        // Fecha de revisión: no puede ser futura ni anterior al intento fallido. Error frecuente en el Excel: el mes
        // adelantado uno (22/10 en lugar de 22/09); si restando un mes la fecha queda entre el intento y hoy, se corrige el mes.
        // Una revisión varios días después del intento (seguimiento) se respeta.
        if (evDay) {
          const DAY = 864e5, t = (x) => Date.parse(x + 'T00:00:00Z');
          const menos = fecha ? (() => { const d = new Date(fecha + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })() : null;
          const menosOk = menos && menos <= today() && t(menos) >= t(evDay) - DAY;
          let nueva = fecha;
          if (!fecha) nueva = evDay;
          else if (fecha > today()) nueva = menosOk ? menos : evDay;
          else if (t(fecha) < t(evDay) - DAY) nueva = evDay;
          else if (t(fecha) - t(evDay) > 7 * DAY && menosOk) nueva = menos;
          if (fecha && nueva !== fecha) out.avisos.push(nueva === menos ? `${sh.name} fila ${r}: fecha ${fecha} con el mes adelantado; se tomó ${menos}.` : `${sh.name} fila ${r}: fecha ${fecha} no coincide con el intento fallido (${evDay}); se tomó ${evDay}.`);
          fecha = nueva;
        }
        if (!fecha) { out.avisos.push(`${sh.name} fila ${r}: sin fecha; se omitió.`); continue; }
        const mac = C.vacio(v(cMac)), user = C.vacio(v(cUser));
        if (!mac && !user) { out.avisos.push(`${sh.name} fila ${r}: sin username ni MAC; se omitió.`); continue; }
        out.casos.push({ sedeId: sede.id, sede: sede.name, fecha, username: user && !C.MAC_RE.test(user) ? user : null, nombre: C.vacio(v(cNom)) && !/^anonymous$/i.test(v(cNom)) ? String(v(cNom)) : null,
          mac: mac || (user && C.MAC_RE.test(user) ? user : null), falla: v(cFalla) ? String(v(cFalla)) : null, intentos: Number(v(cInt)) || null, ssid: v(cSsid) ? String(v(cSsid)) : null, ap: v(cAp) ? String(v(cAp)) : null,
          evento: ev, comentario: v(cCom) ? String(v(cCom)) : null });
        n += 1;
      }
      out.hojas.push({ hoja: sh.name, sede: sede.name, casos: n });
    }
    return out;
  }

  function weeklySummary() {
    const weeks = new Map();
    for (const r of db.prepare('SELECT fecha, estado, updated_at AS u FROM mon_casos').all()) {
      const wk = mondayOf(r.fecha);
      const w = weeks.get(wk) || { week: wk, revisados: 0, contactados: 0, corregidos: 0, en_espera: 0, sin_datos: 0, pendientes: 0, updatedAt: r.u };
      w.revisados += 1;
      if (C.CONTACTADOS.includes(r.estado)) w.contactados += 1;
      if (r.estado === 'exito') w.corregidos += 1;
      if (r.estado === 'cita' || r.estado === 'sin_respuesta') w.en_espera += 1;
      if (r.estado === 'sin_datos') w.sin_datos += 1;
      if (r.estado === 'pendiente') w.pendientes += 1;
      if (r.u > w.updatedAt) w.updatedAt = r.u;
      weeks.set(wk, w);
    }
    return [...weeks.values()];
  }

  async function handle(req, res, url, user) {
    const p = url.pathname, m = req.method;
    if (!p.startsWith('/api/monitoreo')) return false;
    let mm;
    if (p === '/api/monitoreo/catalogo' && m === 'GET') return send(res, 200, catalog()), true;
    if (p === '/api/monitoreo/casos' && m === 'GET') return send(res, 200, list(url.searchParams)), true;
    if (p === '/api/monitoreo/pendientes' && m === 'GET') return send(res, 200, { casos: pendientes() }), true;
    if ((mm = p.match(/^\/api\/monitoreo\/casos\/(\d+)\/seguimiento$/)) && m === 'GET') return send(res, 200, { historial: history(Number(mm[1])) }), true;

    if (p === '/api/monitoreo/casos' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede registrar casos.');
      const body = await readJson(req);
      const sede = db.prepare('SELECT id, name FROM sedes WHERE id = ?').get(Number(body.sedeId));
      if (!sede) throw new HttpError(400, 'Selecciona la sede.');
      if (!isDate(body.fecha) || body.fecha > today()) throw new HttpError(400, 'Selecciona la fecha de la revisión (no puede ser futura).');
      let ingeniero = user.id;
      if (body.ingenieroId && Number(body.ingenieroId) !== user.id) {
        if (user.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede registrar a nombre de otro ingeniero.');
        const u = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('admin','ingeniero')").get(Number(body.ingenieroId));
        if (!u) throw new HttpError(400, 'El ingeniero seleccionado no existe.'); ingeniero = u.id;
      }
      const rows = Array.isArray(body.casos) ? body.casos : [];
      if (!rows.length) throw new HttpError(400, 'Agrega al menos un caso.');
      if (rows.length > 300) throw new HttpError(400, 'Registra máximo 300 casos a la vez.');
      const clean2 = rows.map(clean);
      // mismo username escrito distinto (mayúsculas, guiones, espacios): se usa el que ya existe
      const known = new Map(db.prepare('SELECT DISTINCT username FROM mon_casos WHERE username IS NOT NULL').all().map((r) => [C.userKey(r.username), r.username]));
      let unificados = 0;
      for (const c of clean2) { const k = c.username && known.get(C.userKey(c.username)); if (k && k !== c.username) { c.username = k; unificados += 1; } }
      const dup = db.prepare('SELECT id FROM mon_casos WHERE sede_id = ? AND fecha = ? AND ((dispositivo IS NOT NULL AND dispositivo = ?) OR (dispositivo IS NULL AND lower(username) = lower(?)))');
      const ts = now(); const st = ins(); const lg = logIns();
      let nuevos = 0; const repetidos = [];
      db.exec('BEGIN');
      try {
        clean2.forEach((c, i) => {
          if (dup.get(sede.id, body.fecha, c.dispositivo, c.username)) { repetidos.push(`Renglón ${i + 1} (${c.dispositivo || c.username})`); return; }
          const id = Number(st.run(sede.id, body.fecha, c.username, c.nombre, c.dispositivo, c.falla, c.intentos, c.ssid, c.ap, c.evento, c.estado, c.comentario, ingeniero, 'portal', user.id, ts, user.id, ts).lastInsertRowid);
          lg.run(id, ts, user.id, c.estado, c.comentario);
          nuevos += 1;
        });
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      audit(user.id, 'monitoreo_casos_registrados', { sede: sede.name, fecha: body.fecha, nuevos, repetidos: repetidos.length });
      return send(res, 200, { nuevos, repetidos, unificados }), true;
    }

    if ((mm = p.match(/^\/api\/monitoreo\/casos\/(\d+)$/))) {
      const caso = db.prepare('SELECT * FROM mon_casos WHERE id = ?').get(Number(mm[1]));
      if (!caso) throw new HttpError(404, 'El caso no existe.');
      if (m === 'PUT') {
        if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede actualizar casos.');
        const body = await readJson(req);
        const estado = C.ESTADO[body.estado] ? body.estado : caso.estado;
        const nota = txt(body.nota, 1000);
        const fields = body.datos ? clean({ ...body.datos, estado }, 0) : null;
        // asignación del caso: el admin asigna a cualquiera; un ingeniero solo puede tomar un caso sin asignar
        let asignar;
        if (body.ingenieroId !== undefined) {
          const to = body.ingenieroId ? Number(body.ingenieroId) : null;
          if (user.role !== 'admin' && !(to === user.id && !caso.ingeniero_id)) throw new HttpError(403, 'Solo un administrador puede reasignar casos. Puedes tomar los que no tienen ingeniero.');
          if (to && !db.prepare("SELECT 1 FROM users WHERE id = ? AND role IN ('admin','ingeniero')").get(to)) throw new HttpError(400, 'El ingeniero seleccionado no existe.');
          asignar = to;
        }
        if (estado === caso.estado && !nota && !fields && asignar === undefined) throw new HttpError(400, 'No hay cambios que guardar.');
        const ts = now();
        if (asignar !== undefined) {
          db.prepare('UPDATE mon_casos SET ingeniero_id = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(asignar, user.id, ts, caso.id);
          const who = asignar ? db.prepare('SELECT name FROM users WHERE id = ?').get(asignar).name : 'nadie';
          logIns().run(caso.id, ts, user.id, null, `Caso asignado a ${who}.`);
          audit(user.id, 'monitoreo_caso_asignado', { caso: caso.id, a: who });
          if (estado === caso.estado && !nota && !fields) return send(res, 200, { ok: true }), true;
        }
        if (fields) db.prepare('UPDATE mon_casos SET username = ?, nombre = ?, dispositivo = ?, falla = ?, intentos = ?, ssid = ?, ap = ?, evento = ? WHERE id = ?')
          .run(fields.username, fields.nombre, fields.dispositivo, fields.falla, fields.intentos, fields.ssid, fields.ap, fields.evento, caso.id);
        db.prepare('UPDATE mon_casos SET estado = ?, comentario = COALESCE(?, comentario), updated_by = ?, updated_at = ? WHERE id = ?').run(estado, nota, user.id, ts, caso.id);
        if (estado !== caso.estado || nota) logIns().run(caso.id, ts, user.id, estado, nota);
        audit(user.id, 'monitoreo_seguimiento', { caso: caso.id, antes: caso.estado, despues: estado });
        return send(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE') {
        if (!(user.role === 'admin' || (user.role === 'ingeniero' && caso.created_by === user.id))) throw new HttpError(403, 'Solo quien registró el caso o un administrador puede eliminarlo.');
        db.prepare('DELETE FROM mon_seguimiento WHERE caso_id = ?').run(caso.id);
        db.prepare('DELETE FROM mon_casos WHERE id = ?').run(caso.id);
        audit(user.id, 'monitoreo_caso_eliminado', { caso: caso.id, dispositivo: caso.dispositivo, fecha: caso.fecha });
        return send(res, 200, { ok: true }), true;
      }
    }

    if (p === '/api/monitoreo/historico' && m === 'POST') {
      if (user.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede importar el histórico.');
      const buf = await new Promise((resolve, reject) => { let size = 0; const ch = []; req.on('data', (c) => { size += c.length; if (size > 15 * 1024 * 1024) { reject(new HttpError(413, 'El archivo es demasiado grande (máximo 15 MB).')); req.destroy(); } else ch.push(c); }); req.on('end', () => resolve(Buffer.concat(ch))); req.on('error', reject); });
      let parsed; try { parsed = parseHistorico(buf); } catch (e) { throw new HttpError(400, e.message || 'No se pudo leer el archivo.'); }
      const dup = db.prepare('SELECT id FROM mon_casos WHERE sede_id = ? AND fecha = ? AND ((dispositivo IS NOT NULL AND dispositivo = ?) OR (dispositivo IS NULL AND lower(username) = lower(?)))');
      const seen = new Set(); let nuevos = 0, repetidos = 0;
      const clean1 = (t, n) => txt(t, n);
      const rows = parsed.casos.map((c) => ({ ...c, nombre: clean1(c.nombre, 120), falla: clean1(c.falla, 160), ssid: clean1(c.ssid, 40), ap: clean1(c.ap, 60), comentario: clean1(c.comentario, 1000), username: c.username ? String(c.username).toUpperCase().replace(/\s+/g, '').slice(0, 60) : null, dispositivo: disp(c.mac), estado: C.estadoDe(c.comentario) }));
      const commit = url.searchParams.get('modo') === 'guardar';
      const ts = now(); const st = ins(); const lg = logIns();
      if (commit) db.exec('BEGIN');
      try {
        for (const c of rows) {
          const k = `${c.sedeId}|${c.fecha}|${c.dispositivo || C.plain(c.username)}`;
          if (seen.has(k) || dup.get(c.sedeId, c.fecha, c.dispositivo, c.username)) { repetidos += 1; continue; }
          seen.add(k); nuevos += 1;
          if (commit) { const id = Number(st.run(c.sedeId, c.fecha, c.username, c.nombre, c.dispositivo, c.falla, Number.isInteger(c.intentos) ? c.intentos : null, c.ssid, c.ap, c.evento, c.estado, c.comentario, null, 'historico', user.id, ts, user.id, ts).lastInsertRowid); lg.run(id, ts, null, c.estado, c.comentario); }
        }
        if (commit) db.exec('COMMIT');
      } catch (e) { if (commit) db.exec('ROLLBACK'); throw e; }
      const porEstado = Object.fromEntries(C.ESTADOS.map((e) => [e.key, rows.filter((r) => r.estado === e.key).length]));
      if (commit) audit(user.id, 'monitoreo_historico_importado', { nuevos, repetidos });
      return send(res, 200, { hojas: parsed.hojas, avisos: parsed.avisos.slice(0, 60), totalAvisos: parsed.avisos.length, nuevos, repetidos, porEstado, guardado: commit }), true;
    }

    if (p === '/api/monitoreo/export.csv' && m === 'GET') {
      const { casos } = list(url.searchParams);
      const q = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const lines = [['Fecha', 'Sede', 'Username', 'Nombre', 'MAC / dispositivo', 'Falla', 'Intentos fallidos', 'SSID', 'AP', 'Último intento', 'Estado', 'Comentario', 'Ingeniero', 'Casos anteriores del mismo usuario'].join(',')]
        .concat(casos.map((c) => [c.fecha, c.sede, c.username, c.nombre, c.dispositivo, c.falla, c.intentos, c.ssid, c.ap, c.evento ? c.evento.replace('T', ' ') : '', C.ESTADO[c.estado].label, c.comentario, c.ingeniero, c.otros].map(q).join(',')));
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="monitoreo-proactivo.csv"', 'Cache-Control': 'no-store' });
      res.end('﻿' + lines.join('\r\n'));
      return true;
    }
    throw new HttpError(404, 'Ruta no encontrada.');
  }

  return { handle, weeklySummary };
};
