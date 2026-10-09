'use strict';
/*
 * Rediseño WLAN: seguimiento diario de usuarios y utilización de canal por AP.
 * Carga desde Excel o captura manual; todo queda con usuario y hora. Tablas nuevas, sin tocar las existentes.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseWorkbook, apName, apPiso, plain } = require('./rediseno-formato');

// Usuarios por AP: más de 37 es alarmante (criterio de rediseño); de 30 a 37 es regular.
const UMBRALES = { regular: 30, alarm: 37 };
const MAX_SLOTS = 8;
const keyOf = (s) => plain(s).replace(/[^a-z0-9]/g, '');
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

module.exports = function init(ctx) {
  const { db, HttpError, send, readJson, audit, now } = ctx;
  db.exec(`
    CREATE TABLE IF NOT EXISTS rd_sedes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS rd_aps (id INTEGER PRIMARY KEY, sede_id INTEGER NOT NULL REFERENCES rd_sedes(id), name TEXT NOT NULL UNIQUE, piso TEXT);
    CREATE TABLE IF NOT EXISTS rd_cargas (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, user_id INTEGER REFERENCES users(id), tipo TEXT NOT NULL, archivo TEXT, resumen TEXT);
    CREATE TABLE IF NOT EXISTS rd_lecturas (
      id INTEGER PRIMARY KEY, ap_id INTEGER NOT NULL REFERENCES rd_aps(id), fecha TEXT NOT NULL, slot INTEGER NOT NULL, hora TEXT,
      usuarios INTEGER, util REAL, source TEXT NOT NULL, carga_id INTEGER REFERENCES rd_cargas(id),
      created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL,
      UNIQUE (ap_id, fecha, slot)
    );
    CREATE INDEX IF NOT EXISTS rd_lecturas_fecha ON rd_lecturas (fecha);
  `);

  const canWrite = (u) => u.role === 'admin' || u.role === 'ingeniero';
  // La iniciativa guarda su criterio en la base: se alinea con el umbral vigente (cambio de 30 a 37 usuarios por AP).
  const ini = db.prepare("SELECT id, def FROM initiatives WHERE slug = 'rediseno'").get();
  if (ini) {
    const def = JSON.parse(ini.def);
    const k = (def.kpis || [])[0];
    if (k && k.limit !== undefined && k.limit !== UMBRALES.alarm) {
      const old = k.limit;
      const swap = (t) => (typeof t === 'string' ? t.replace(new RegExp(`\\b${old}( dispositivos por AP)`, 'g'), `${UMBRALES.alarm}$1`) : t);
      k.limit = UMBRALES.alarm;
      k.note = swap(k.note);
      for (const sec of def.sections || []) if (Array.isArray(sec.items)) sec.items = sec.items.map(swap);
      db.prepare('UPDATE initiatives SET def = ? WHERE id = ?').run(JSON.stringify(def), ini.id);
      audit(null, 'rediseno_criterio_actualizado', { antes: old, despues: UMBRALES.alarm });
      console.log(`Rediseño WLAN: el criterio pasó de ${old} a ${UMBRALES.alarm} usuarios por AP.`);
    }
  }

  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const today = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10); // tolera el desfase con UTC
  const mondayOf = (s) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const weekend = (s) => [0, 6].includes(new Date(s + 'T00:00:00Z').getUTCDay());

  const getSede = (name, create) => {
    const key = keyOf(name);
    let row = db.prepare('SELECT id, name FROM rd_sedes WHERE key = ?').get(key);
    if (!row && create) {
      const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM rd_sedes').get().n;
      row = { id: Number(db.prepare('INSERT INTO rd_sedes (name, key, sort) VALUES (?,?,?)').run(name, key, sort).lastInsertRowid), name };
    }
    return row || null;
  };

  /** Revisa (y si commit, guarda) las lecturas leídas de un Excel. Devuelve el resumen que ve el ingeniero. */
  function importParsed(parsed, user, commit, archivo, tipo = 'excel') {
    const issues = [...parsed.issues];
    const issue = (level, sede, where, msg) => issues.push({ level, sede, where, msg });
    const resumen = { sedes: [], nuevas: 0, actualizadas: 0, sinCambio: 0, omitidas: 0, apsNuevos: [], sedesNuevas: [], cambios: [] };
    const limit = today();
    const apByName = new Map(db.prepare('SELECT a.id, a.name, a.sede_id AS sedeId FROM rd_aps a').all().map((a) => [a.name, a]));
    const existing = db.prepare('SELECT id, usuarios, util, hora FROM rd_lecturas WHERE ap_id = ? AND fecha = ? AND slot = ?');
    const hasData = db.prepare('SELECT COUNT(*) AS n FROM rd_lecturas').get().n > 0;
    let cargaId = null;
    if (commit) {
      db.exec('BEGIN');
      cargaId = Number(db.prepare('INSERT INTO rd_cargas (ts, user_id, tipo, archivo) VALUES (?,?,?,?)').run(now(), user ? user.id : null, tipo, archivo || null).lastInsertRowid);
    }
    try {
      // Varias hojas o grupos pueden ser la misma sede: se reúnen por la sede a la que ya pertenecen sus AP.
      const merged = new Map();
      for (const s of parsed.sedes) {
        const owners = new Set(s.readings.map((r) => apByName.get(r.ap)).filter(Boolean).map((a) => a.sedeId));
        const owner = owners.size === 1 ? db.prepare('SELECT id, name FROM rd_sedes WHERE id = ?').get([...owners][0]) : null;
        const name = owner ? owner.name : s.name;
        if (!name) { resumen.omitidas += s.readings.length; issue('error', '', s.sheet, `${s.readings.length} lecturas de AP que no existen en el portal y sin sede indicada; se omitieron. Agrega la sede en la fila o da de alta el AP.`); continue; }
        if (owners.size > 1) issue('aviso', name, s.sheet, `La hoja "${s.sheet}" mezcla AP de varias sedes; cada lectura se guarda con la sede de su AP.`);
        const g = merged.get(name) || { name, sheet: s.sheet, readings: [] };
        g.readings.push(...s.readings); merged.set(name, g);
      }
      for (const s of merged.values()) {
        let sede = getSede(s.name, commit);
        if (!sede) { resumen.sedesNuevas.push(s.name); if (hasData) issue('error', s.name, s.sheet, `"${s.name}" no coincide con ninguna sede del portal y sus AP son nuevos; si se guarda, se creará como sede nueva. Revisa el nombre.`); sede = { id: null, name: s.name }; }
        const slotNext = new Map();
        const nullSeen = new Map();
        const st = { sede: s.name, lecturas: 0, nuevas: 0, actualizadas: 0, sinCambio: 0, dias: new Set(), aps: new Set(), finDeSemana: 0, sobreUmbral: 0 };
        const known = [...apByName.values()].filter((a) => a.sedeId === sede.id).map((a) => a.name);
        for (const r of s.readings) {
          if (r.fecha > limit) { resumen.omitidas += 1; issue('error', s.name, s.sheet, `${r.ap}: la fecha ${r.fecha} es futura; la lectura se omitió.`); continue; }
          if (!r.byHora && r.slot > MAX_SLOTS) { resumen.omitidas += 1; continue; }
          let ap = apByName.get(r.ap);
          if (ap && sede.id && ap.sedeId !== sede.id) { resumen.omitidas += 1; issue('error', s.name, s.sheet, `${r.ap} ya pertenece a otra sede; sus lecturas en esta hoja se omitieron.`); continue; }
          if (!ap) {
            if (!resumen.apsNuevos.includes(r.ap)) {
              resumen.apsNuevos.push(r.ap);
              const near = known.find((k) => lev(k, r.ap) <= 2);
              if (hasData) issue(near ? 'error' : 'aviso', s.name, s.sheet, near ? `"${r.ap}" no existe y se parece a "${near}": revisa si es un error de captura. Si se guarda, se creará como AP nuevo.` : `"${r.ap}" es un AP nuevo en ${s.name}; se dará de alta.`);
            }
            if (commit) { ap = { id: Number(db.prepare('INSERT INTO rd_aps (sede_id, name, piso) VALUES (?,?,?)').run(sede.id, r.ap, r.piso).lastInsertRowid), name: r.ap, sedeId: sede.id }; apByName.set(r.ap, ap); }
          }
          st.lecturas += 1; st.dias.add(r.fecha); st.aps.add(r.ap);
          if (weekend(r.fecha)) st.finDeSemana += 1;
          if (r.usuarios !== null && r.usuarios > UMBRALES.alarm) st.sobreUmbral += 1;
          if (r.usuarios !== null && r.usuarios > 80) issue('aviso', s.name, s.sheet, `${r.ap} (${r.fecha}): ${r.usuarios} usuarios es un valor atípico; verifica que sea correcto.`);
          // Formato de tabla: la lectura se identifica por su hora; sin hora, por su orden dentro del día.
          let prev = null;
          if (r.byHora && ap) {
            if (r.hora) prev = db.prepare('SELECT id, usuarios, util, hora FROM rd_lecturas WHERE ap_id = ? AND fecha = ? AND hora = ?').get(ap.id, r.fecha, r.hora);
            else { const k = `${ap.id}|${r.fecha}`; const n = nullSeen.get(k) || 0; nullSeen.set(k, n + 1); prev = db.prepare('SELECT id, usuarios, util, hora FROM rd_lecturas WHERE ap_id = ? AND fecha = ? AND hora IS NULL ORDER BY slot LIMIT 1 OFFSET ?').get(ap.id, r.fecha, n); }
            if (!prev) {
              const k = `${ap ? ap.id : r.ap}|${r.fecha}`;
              const base = slotNext.has(k) ? slotNext.get(k) : (ap && ap.id ? db.prepare('SELECT COALESCE(MAX(slot), 0) AS n FROM rd_lecturas WHERE ap_id = ? AND fecha = ?').get(ap.id, r.fecha).n : 0);
              r.slot = base + 1; slotNext.set(k, r.slot);
            }
          } else if (r.byHora && !ap) {
            const k = `${r.ap}|${r.fecha}`; r.slot = (slotNext.get(k) || 0) + 1; slotNext.set(k, r.slot);
          } else prev = ap ? existing.get(ap.id, r.fecha, r.slot) : null;
          if (!prev) {
            st.nuevas += 1;
            if (commit) db.prepare(`INSERT INTO rd_lecturas (ap_id, fecha, slot, hora, usuarios, util, source, carga_id, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(ap.id, r.fecha, r.slot, r.hora, r.usuarios, r.util, tipo, cargaId, user ? user.id : null, now(), user ? user.id : null, now());
          } else if (prev.usuarios !== r.usuarios || prev.util !== r.util) {
            st.actualizadas += 1;
            if (resumen.cambios.length < 40) resumen.cambios.push({ ap: r.ap, fecha: r.fecha, hora: r.hora || `lectura ${r.slot}`, antes: { usuarios: prev.usuarios, util: prev.util }, despues: { usuarios: r.usuarios, util: r.util } });
            if (commit) db.prepare('UPDATE rd_lecturas SET usuarios = ?, util = ?, hora = COALESCE(?, hora), carga_id = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(r.usuarios, r.util, r.hora, cargaId, user ? user.id : null, now(), prev.id);
          } else st.sinCambio += 1;
        }
        if (st.finDeSemana) issue('aviso', s.name, s.sheet, `${st.finDeSemana} lecturas caen en sábado o domingo; confirma las fechas.`);
        const dias = [...st.dias].sort();
        resumen.sedes.push({ sede: s.name, lecturas: st.lecturas, nuevas: st.nuevas, actualizadas: st.actualizadas, sinCambio: st.sinCambio, dias: dias.length, desde: dias[0] || null, hasta: dias[dias.length - 1] || null, aps: st.aps.size, sobreUmbral: st.sobreUmbral });
        resumen.nuevas += st.nuevas; resumen.actualizadas += st.actualizadas; resumen.sinCambio += st.sinCambio;
      }
      const errores = issues.filter((i) => i.level === 'error').length;
      resumen.errores = errores; resumen.avisos = issues.length - errores;
      if (commit) {
        db.prepare('UPDATE rd_cargas SET resumen = ? WHERE id = ?').run(JSON.stringify({ nuevas: resumen.nuevas, actualizadas: resumen.actualizadas, sinCambio: resumen.sinCambio, omitidas: resumen.omitidas, errores, avisos: resumen.avisos, sedes: resumen.sedes.map((x) => x.sede) }), cargaId);
        db.exec('COMMIT');
      }
    } catch (err) { if (commit) db.exec('ROLLBACK'); throw err; }
    // los avisos repetidos se agrupan para que el resumen sea legible
    const grouped = new Map();
    for (const i of issues) {
      const k = `${i.level}|${i.sede}|${i.msg.replace(/"[^"]*"|\d{4}-\d{2}-\d{2}|\d+(\.\d+)?%?/g, '#')}`;
      const g = grouped.get(k) || { level: i.level, sede: i.sede, msg: i.msg, where: i.where, count: 0 };
      g.count += 1; grouped.set(k, g);
    }
    resumen.issues = [...grouped.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1)).slice(0, 80);
    return resumen;
  }

  // Carga inicial con el histórico del reporte de Excel (solo si la base está vacía).
  const seedFile = path.join(__dirname, 'seed-rediseno.json');
  if (db.prepare('SELECT COUNT(*) AS n FROM rd_lecturas').get().n === 0 && fs.existsSync(seedFile)) {
    const seedData = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    const parsed = { issues: [], sedes: seedData.sedes.map((s) => ({ name: s.name, sheet: s.name, readings: s.readings.map(([a, fecha, slot, hora, usuarios, util]) => ({ ap: s.aps[a], piso: apPiso(s.aps[a]), fecha, slot, hora, usuarios, util })) })) };
    const r = importParsed(parsed, null, true, seedData.archivo, 'inicial');
    console.log(`Rediseño WLAN: se cargó el histórico inicial (${r.nuevas} lecturas de ${r.sedes.length} sedes).`);
  }

  function readRaw(req, max) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > max) { reject(new HttpError(413, 'El archivo es demasiado grande (máximo 15 MB).')); req.destroy(); return; } chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function summary(q) {
    const rango = db.prepare('SELECT MIN(fecha) AS min, MAX(fecha) AS max FROM rd_lecturas').get();
    const hasta = isDate(q.get('hasta')) ? q.get('hasta') : rango.max || new Date().toISOString().slice(0, 10);
    let desde = isDate(q.get('desde')) ? q.get('desde') : null;
    if (!desde) { const d = new Date(hasta + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 13); desde = d.toISOString().slice(0, 10); }
    const aps = db.prepare('SELECT id, sede_id AS sedeId, name, piso FROM rd_aps ORDER BY name').all();
    return {
      desde, hasta, rango, umbrales: UMBRALES,
      sedes: db.prepare('SELECT id, name FROM rd_sedes ORDER BY sort, id').all().map((s) => ({ ...s, aps: aps.filter((a) => a.sedeId === s.id).map(({ id, name, piso }) => ({ id, name, piso })) })),
      diario: db.prepare(`SELECT ap_id, fecha, COUNT(*) AS n, AVG(usuarios) AS uAvg, MAX(usuarios) AS uMax, AVG(util) AS cAvg, MAX(util) AS cMax
        FROM rd_lecturas WHERE fecha BETWEEN ? AND ? GROUP BY ap_id, fecha ORDER BY fecha`).all(desde, hasta)
        .map((r) => [r.ap_id, r.fecha, r.n, r.uAvg === null ? null : Math.round(r.uAvg * 100) / 100, r.uMax, r.cAvg === null ? null : Math.round(r.cAvg * 100) / 100, r.cMax]),
      cargas: db.prepare(`SELECT c.id, c.ts, c.tipo, c.archivo, c.resumen, COALESCE(u.name, 'Carga inicial') AS user FROM rd_cargas c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 12`).all()
        .map((c) => ({ ...c, resumen: c.resumen ? JSON.parse(c.resumen) : null })),
    };
  }

  /** Promedio semanal de dispositivos por AP, para el indicador de la iniciativa. */
  function weeklySummary() {
    const weeks = new Map();
    for (const r of db.prepare('SELECT fecha, SUM(usuarios) AS s, COUNT(usuarios) AS n, MAX(usuarios) AS mx, MAX(updated_at) AS u FROM rd_lecturas WHERE usuarios IS NOT NULL GROUP BY fecha').all()) {
      const wk = mondayOf(r.fecha);
      const w = weeks.get(wk) || { week: wk, sum: 0, n: 0, max: 0, dias: 0, updatedAt: r.u };
      w.sum += r.s; w.n += r.n; w.dias += 1; if (r.mx > w.max) w.max = r.mx; if (r.u > w.updatedAt) w.updatedAt = r.u;
      weeks.set(wk, w);
    }
    return [...weeks.values()].map((w) => ({ week: w.week, promedio: Math.round((w.sum / w.n) * 10) / 10, lecturas: w.n, pico: w.max, dias: w.dias, updatedAt: w.updatedAt }));
  }

  async function handle(req, res, url, user) {
    const p = url.pathname;
    const m = req.method;
    if (!p.startsWith('/api/rediseno')) return false;

    if (p === '/api/rediseno/resumen' && m === 'GET') return send(res, 200, summary(url.searchParams)), true;

    if (p === '/api/rediseno/lecturas' && m === 'GET') {
      const sedeId = Number(url.searchParams.get('sede')); const fecha = url.searchParams.get('fecha');
      if (!isDate(fecha)) throw new HttpError(400, 'Fecha no válida.');
      return send(res, 200, { lecturas: db.prepare(`SELECT l.ap_id AS apId, l.slot, l.hora, l.usuarios, l.util, l.source, l.updated_at AS updatedAt, COALESCE(u.name, 'Carga inicial') AS user
        FROM rd_lecturas l JOIN rd_aps a ON a.id = l.ap_id LEFT JOIN users u ON u.id = l.updated_by WHERE a.sede_id = ? AND l.fecha = ? ORDER BY l.slot`).all(sedeId, fecha) }), true;
    }

    if (p === '/api/rediseno/importar' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede cargar información.');
      const commit = url.searchParams.get('modo') === 'guardar';
      const archivo = String(url.searchParams.get('nombre') || 'reporte.xlsx').replace(/[^\w .()áéíóúñÁÉÍÓÚÑ-]/g, '').slice(0, 120);
      const buf = await readRaw(req, 15 * 1024 * 1024);
      if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw new HttpError(400, 'El archivo no es un Excel .xlsx. Si es .xls o .csv, guárdalo como .xlsx.');
      let parsed;
      try { parsed = parseWorkbook(buf); } catch (err) { throw new HttpError(400, err.message || 'No se pudo leer el archivo.'); }
      const r = importParsed(parsed, user, commit, archivo);
      if (commit) audit(user.id, 'rediseno_excel_cargado', { archivo, nuevas: r.nuevas, actualizadas: r.actualizadas, errores: r.errores });
      return send(res, 200, { guardado: commit, archivo, ...r }), true;
    }

    if (p === '/api/rediseno/lecturas' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede capturar lecturas.');
      const body = await readJson(req);
      const sede = db.prepare('SELECT id, name FROM rd_sedes WHERE id = ?').get(Number(body.sedeId));
      if (!sede) throw new HttpError(400, 'Selecciona la sede.');
      if (!isDate(body.fecha) || body.fecha > today()) throw new HttpError(400, 'Selecciona una fecha válida, no futura.');
      if (!isTime(body.hora)) throw new HttpError(400, 'Escribe la hora de la lectura en formato de 24 horas, por ejemplo 11:00.');
      if (!Array.isArray(body.lecturas) || !body.lecturas.length) throw new HttpError(400, 'Captura al menos un AP.');
      const aps = new Map(db.prepare('SELECT id, name FROM rd_aps WHERE sede_id = ?').all(sede.id).map((a) => [a.id, a]));
      const rows = []; const raros = [];
      for (const l of body.lecturas.slice(0, 200)) {
        const ap = aps.get(Number(l.apId));
        if (!ap) throw new HttpError(400, 'Uno de los AP no pertenece a la sede seleccionada.');
        const blank = (v) => v === '' || v === null || v === undefined;
        if (blank(l.usuarios) && blank(l.util)) continue;
        const usuarios = blank(l.usuarios) ? null : Number(l.usuarios);
        const util = blank(l.util) ? null : Number(String(l.util).replace(',', '.'));
        if (usuarios !== null && (!Number.isInteger(usuarios) || usuarios < 0 || usuarios > 500)) throw new HttpError(400, `${ap.name}: los usuarios deben ser un número entero entre 0 y 500.`);
        if (util !== null && (!Number.isFinite(util) || util < 0 || util > 100)) throw new HttpError(400, `${ap.name}: la utilización de canal debe estar entre 0 y 100%.`);
        if (usuarios === null) throw new HttpError(400, `${ap.name}: falta el número de usuarios.`);
        const hist = db.prepare("SELECT MAX(usuarios) AS mx FROM rd_lecturas WHERE ap_id = ? AND fecha >= date(?, '-30 day') AND fecha < ?").get(ap.id, body.fecha, body.fecha).mx;
        if (hist !== null && usuarios > Math.max(UMBRALES.alarm, hist * 2)) raros.push(`${ap.name}: ${usuarios} usuarios (su máximo de los últimos 30 días es ${hist})`);
        rows.push({ ap, usuarios, util: util === null ? null : Math.round(util * 100) / 100 });
      }
      if (!rows.length) throw new HttpError(400, 'Captura al menos un AP.');
      if (raros.length && !body.confirm) { const e = new HttpError(409, 'Hay valores muy por encima de lo habitual. Confirma que son correctos.', 'atipico'); e.extra = { raros }; throw e; }
      db.exec('BEGIN');
      try {
        const cargaId = Number(db.prepare('INSERT INTO rd_cargas (ts, user_id, tipo, archivo) VALUES (?,?,?,?)').run(now(), user.id, 'manual', `${sede.name} · ${body.fecha} ${body.hora}`).lastInsertRowid);
        let nuevas = 0, actualizadas = 0;
        for (const r of rows) {
          const same = db.prepare('SELECT id FROM rd_lecturas WHERE ap_id = ? AND fecha = ? AND hora = ?').get(r.ap.id, body.fecha, body.hora);
          if (same) { db.prepare('UPDATE rd_lecturas SET usuarios = ?, util = ?, carga_id = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(r.usuarios, r.util, cargaId, user.id, now(), same.id); actualizadas += 1; continue; }
          const slot = db.prepare('SELECT COALESCE(MAX(slot), 0) + 1 AS n FROM rd_lecturas WHERE ap_id = ? AND fecha = ?').get(r.ap.id, body.fecha).n;
          if (slot > MAX_SLOTS) throw new HttpError(400, `${r.ap.name} ya tiene ${MAX_SLOTS} lecturas ese día.`);
          db.prepare(`INSERT INTO rd_lecturas (ap_id, fecha, slot, hora, usuarios, util, source, carga_id, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,'manual',?,?,?,?,?)`)
            .run(r.ap.id, body.fecha, slot, body.hora, r.usuarios, r.util, cargaId, user.id, now(), user.id, now());
          nuevas += 1;
        }
        db.prepare('UPDATE rd_cargas SET resumen = ? WHERE id = ?').run(JSON.stringify({ nuevas, actualizadas, sinCambio: 0, omitidas: 0, errores: 0, avisos: raros.length, sedes: [sede.name] }), cargaId);
        db.exec('COMMIT');
        audit(user.id, 'rediseno_captura_manual', { sede: sede.name, fecha: body.fecha, hora: body.hora, lecturas: rows.length });
        return send(res, 200, { ok: true, nuevas, actualizadas }), true;
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    }

    if (p === '/api/rediseno/aps' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario no puede agregar AP.');
      const body = await readJson(req);
      const sede = db.prepare('SELECT id, name FROM rd_sedes WHERE id = ?').get(Number(body.sedeId));
      if (!sede) throw new HttpError(400, 'Selecciona la sede.');
      const name = apName(String(body.name || '').trim());
      if (!/^AP-[A-Z0-9-]{3,50}$/.test(name)) throw new HttpError(400, 'El nombre del AP debe tener la forma AP-P37-MR56-PUEBLA-08.');
      const all = db.prepare('SELECT name FROM rd_aps').all().map((a) => a.name);
      if (all.includes(name)) throw new HttpError(409, 'Ese AP ya existe.');
      const near = all.find((k) => lev(k, name) === 1);
      if (near && !body.confirm) { const e = new HttpError(409, `Ya existe "${near}", con un nombre casi igual.`, 'similar'); e.extra = { near }; throw e; }
      db.prepare('INSERT INTO rd_aps (sede_id, name, piso) VALUES (?,?,?)').run(sede.id, name, apPiso(name));
      audit(user.id, 'rediseno_ap_creado', { sede: sede.name, name });
      return send(res, 200, { ok: true, name }), true;
    }

    let mm;
    if ((mm = p.match(/^\/api\/rediseno\/cargas\/(\d+)$/)) && m === 'DELETE') {
      const c = db.prepare('SELECT * FROM rd_cargas WHERE id = ?').get(Number(mm[1]));
      if (!c) throw new HttpError(404, 'La carga no existe.');
      if (!(user.role === 'admin' || (c.tipo === 'manual' && c.user_id === user.id))) throw new HttpError(403, 'Solo un administrador puede deshacer esta carga.');
      const n = db.prepare('DELETE FROM rd_lecturas WHERE carga_id = ?').run(c.id).changes;
      db.prepare('UPDATE rd_cargas SET resumen = ? WHERE id = ?').run(JSON.stringify({ ...(c.resumen ? JSON.parse(c.resumen) : {}), deshecha: { por: user.name, ts: now(), lecturas: Number(n) } }), c.id);
      audit(user.id, 'rediseno_carga_deshecha', { carga: c.id, archivo: c.archivo, lecturas: Number(n) });
      return send(res, 200, { ok: true, lecturas: Number(n) }), true;
    }
    return false;
  }

  return { handle, weeklySummary, importParsed };
};
