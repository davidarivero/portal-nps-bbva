'use strict';
/*
 * Homologación de QoS WLAN: pérdida de paquetes en las interfaces de switch hacia los AP.
 * Toda la información entra por archivo (.zip, .txt o .xlsx con los contadores de colas de cada interfaz); no hay captura manual.
 * Cada carga pertenece a un corte (fecha): la línea base (antes de QoS) o un seguimiento semanal.
 * Tablas nuevas; no modifica las existentes.
 */
const path = require('node:path');
const C = require('./public/js/qos-comun.js');
const { readXlsx, unzip } = require('./xlsx-lite.js');

module.exports = function init(ctx) {
  const { db, HttpError, send, readJson, audit, now } = ctx;

  db.exec(`
    CREATE TABLE IF NOT EXISTS qos_cortes (
      id INTEGER PRIMARY KEY, fecha TEXT NOT NULL UNIQUE, tipo TEXT NOT NULL, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qos_cargas (
      id INTEGER PRIMARY KEY, corte_id INTEGER NOT NULL REFERENCES qos_cortes(id) ON DELETE CASCADE, ts TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id), archivo TEXT, resumen TEXT
    );
    CREATE TABLE IF NOT EXISTS qos_lecturas (
      id INTEGER PRIMARY KEY, corte_id INTEGER NOT NULL REFERENCES qos_cortes(id) ON DELETE CASCADE, carga_id INTEGER REFERENCES qos_cargas(id),
      sede TEXT NOT NULL, host TEXT NOT NULL, ip TEXT, intf TEXT NOT NULL, ap TEXT, src TEXT NOT NULL, ok INTEGER NOT NULL, err TEXT,
      enq0 INTEGER NOT NULL DEFAULT 0, enq1 INTEGER NOT NULL DEFAULT 0, enq2 INTEGER NOT NULL DEFAULT 0, enq3 INTEGER NOT NULL DEFAULT 0,
      drp0 INTEGER NOT NULL DEFAULT 0, drp1 INTEGER NOT NULL DEFAULT 0, drp2 INTEGER NOT NULL DEFAULT 0, drp3 INTEGER NOT NULL DEFAULT 0,
      UNIQUE (corte_id, host, intf)
    );
    CREATE INDEX IF NOT EXISTS qos_lecturas_corte ON qos_lecturas (corte_id);
    CREATE TABLE IF NOT EXISTS qos_objetivos (fecha TEXT PRIMARY KEY, valor REAL NOT NULL);
  `);

  const canWrite = (u) => u.role === 'admin' || u.role === 'ingeniero';
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const today = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10); // hora del centro de México
  const MES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  let version = 0; const cache = new Map();
  const touch = () => { version += 1; cache.clear(); };

  /* ------------------------------------------------------------------ iniciativa */
  /** Convierte la iniciativa "qos" anterior (IPSC en bancas remotas) en Homologación de QoS WLAN y la deja primera en el tablero. */
  function ensure() {
    if (!db.prepare('SELECT COUNT(*) AS n FROM initiatives').get().n) return;
    if (!db.prepare('SELECT COUNT(*) AS n FROM qos_objetivos').get().n) {
      const ins = db.prepare('INSERT INTO qos_objetivos (fecha, valor) VALUES (?,?)');
      for (const o of C.OBJETIVOS) ins.run(o.fecha, o.valor);
    }
    const cur = db.prepare("SELECT id, def FROM initiatives WHERE slug = 'qos'").get();
    if (cur && JSON.parse(cur.def).version === C.INICIATIVA.version) return;
    const def = JSON.stringify(C.INICIATIVA);
    if (cur) db.prepare('UPDATE initiatives SET def = ? WHERE id = ?').run(def, cur.id);
    else db.prepare('INSERT INTO initiatives (slug, sort, def) VALUES (?,?,?)').run('qos', -1, def);
    const rows = db.prepare("SELECT slug FROM initiatives WHERE slug <> 'qos' ORDER BY sort, id").all();
    const up = db.prepare('UPDATE initiatives SET sort = ? WHERE slug = ?');
    const order = ['qos', ...rows.map((r) => r.slug)];
    order.forEach((slug, i) => up.run(i, slug));
    audit(null, 'iniciativa_actualizada', { slug: 'qos', nombre: C.INICIATIVA.name, orden: order });
    syncDef();
  }
  /** La métrica inicial (línea base) y el objetivo final del tablero salen de los datos cargados. */
  function syncDef() {
    const cur = db.prepare("SELECT id, def FROM initiatives WHERE slug = 'qos'").get();
    if (!cur) return;
    const def = JSON.parse(cur.def); const k = (def.kpis || []).find((x) => x.key === 'sin_perdida');
    if (!k) return;
    const base = resumenCortes().find((c) => c.tipo === 'base');
    const obj = db.prepare('SELECT valor FROM qos_objetivos ORDER BY fecha DESC LIMIT 1').get();
    const next = { baseline: base && base.clean !== null ? Math.round(base.clean * 10) / 10 : C.META.inicial, baselineLabel: base ? `${fechaTxt(base.fecha)} · antes de QoS` : C.META.inicialLabel, target: obj ? obj.valor : C.META.objetivo };
    if (k.baseline === next.baseline && k.baselineLabel === next.baselineLabel && k.target === next.target) return;
    Object.assign(k, next);
    db.prepare('UPDATE initiatives SET def = ? WHERE id = ?').run(JSON.stringify(def), cur.id);
  }
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fechaTxt = (f) => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]} ${f.slice(0, 4)}`;

  const VUELTA = 2 ** 36; // los contadores de enqueue del FED dan la vuelta en 36 bits
  const DIAS_VIEJO = 4;    // en un seguimiento, una captura con más días de antigüedad que el corte no se carga

  /* ------------------------------------------------------------------ lectura de archivos */
  /** Suma los contadores de un bloque "qos queue stats interface": tráfico encolado y descartado por cola (bytes). Las colas 4 a 7 se suman a la 3. */
  function contadores(lines) {
    const enq = [0, 0, 0, 0], drp = [0, 0, 0, 0]; let mode = null, ok = false, err = null;
    for (const raw of lines) {
      const line = String(raw);
      if (line.includes('Hardware Enqueue Counters')) { mode = 'e'; continue; }
      if (line.includes('Hardware Drop Counters')) { mode = 'd'; continue; }
      const m = line.match(/^\s*(\d)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+(\d+))?\s*$/);
      if (m && mode) {
        const q = Math.min(3, Number(m[1]));
        if (mode === 'e' && m[6] === undefined) enq[q] += Number(m[3]) + Number(m[4]) + Number(m[5]);
        else if (mode === 'd' && m[6] !== undefined) { drp[q] += Number(m[2]) + Number(m[3]) + Number(m[4]) + Number(m[5]) + Number(m[6]); ok = true; }
        continue;
      }
      if (!err && /Invalid input|not found|Incomplete command|Ambiguous command|% ?Error/i.test(line)) err = line.replace(/\s+/g, ' ').trim().slice(0, 140);
    }
    return { enq, drp, ok, err: ok ? null : (err || 'El archivo no trae los contadores de esta interfaz.') };
  }
  /** Fecha local (centro de México) a partir de un "show clock": 17:42:48.240 GMT Thu Nov 12 2026. */
  function fechaClock(txt) {
    const m = String(txt || '').match(/(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?\s+(\w+)\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})/);
    if (!m || !MES[m[5].toLowerCase()]) return null;
    let d = new Date(Date.UTC(Number(m[7]), MES[m[5].toLowerCase()] - 1, Number(m[6]), Number(m[1]), Number(m[2])));
    if (/^(GMT|UTC)$/i.test(m[4])) d = new Date(d.getTime() - 6 * 3600e3);
    return d.toISOString().slice(0, 10);
  }
  /** Fecha escrita en el nombre del archivo o de la carpeta: ..._12_11_2026 o ..._2026-11-12. */
  function fechaNombre(name) {
    const s = String(name || '');
    let m = s.match(/(?:^|[^\d])(\d{2})[_-](\d{2})[_-](20\d{2})(?:[^\d]|$)/);
    if (m && isDate(`${m[3]}-${m[2]}-${m[1]}`)) return `${m[3]}-${m[2]}-${m[1]}`;
    m = s.match(/(20\d{2})[_-](\d{2})[_-](\d{2})/);
    return m && isDate(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  const esBase = (name) => /previ|antes|ante_|pre[-_ ]?qos|linea[-_ ]?base/i.test(C.plain(name));

  /** Respaldo del script (COMMAND: …) o salida de consola (HOST#… qos queue stats interface X). Un archivo por switch. */
  function parseTxt(text, name) {
    const t = String(text).replace(/\r/g, '');
    const base = path.basename(name);
    let host = (t.match(/^HOSTNAME:\s*(\S+)/m) || [])[1] || null;
    let ip = (t.match(/^IP:\s*(\S+)/m) || [])[1] || null;
    const fn = base.match(/^Backup_QoS_(\d+\.\d+\.\d+\.\d+)_(.+?)\.txt$/i);
    if (fn) { host = host || fn[2]; ip = ip || fn[1]; }
    const fecha = fechaClock((t.match(/COMMAND: show clock\n-+\n\s*[*.]?(.+)/) || [])[1]) || fechaNombre(name);
    const re = /^(?:COMMAND:\s*show platform hardware fed .*?qos queue stats interface\s+(\S+)|(\S+?)[#>]\S*.*?qos queue stats interface\s+(\S+))\s*$/gm;
    const marks = [...t.matchAll(re)];
    const out = [];
    marks.forEach((m, i) => {
      if (m[2] && !host) host = m[2];
      const body = t.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : t.length).split('\n');
      const c = contadores(body);
      out.push({ intf: C.intf(m[1] || m[3]), ap: null, src: 'fed', ...c });
    });
    if (!host) { const m = base.match(/^(SW[-\w]+?)(?:_Ante|_Antes|_QoS|\.txt)/i); if (m) host = m[1]; }
    // el prompt dice qué switch respondió: si no es el del encabezado, el salto desde el pivote falló y se capturó otro equipo
    const prompts = [...new Set([...t.matchAll(/^([A-Za-z0-9][\w.-]*)[#>]/gm)].map((m) => m[1]))];
    const ajeno = host ? prompts.find((x) => x.toUpperCase() !== String(host).toUpperCase()) || null : null;
    const pivote = (t.match(/Pivote:\s*(\d+\.\d+\.\d+\.\d+)/i) || [])[1] || null;
    return { tipo: 'txt', name, host, ip, fecha, pivote, ajeno, sede: C.sedeDeHost(host) || C.sedeDeTexto(name), rows: out };
  }

  /** Excel: (a) salida FED renglón por renglón con Hostname e Interfaz; (b) una hoja por sede con AP, Puerto y Drops. */
  function parseXlsx(buf, name) {
    const wb = readXlsx(buf); const files = [];
    const cell = (sh, r, c) => { const x = sh.cells.get(`${r},${c}`); return x ? x.v : null; };
    const serial = (v) => (typeof v === 'number' ? new Date(Math.round((v - 25569) * 86400e3)).toISOString().slice(0, 10) : (String(v || '').match(/20\d{2}-\d{2}-\d{2}/) || [null])[0]);
    for (const sh of wb.sheets) {
      let hdr = null;
      for (let r = 1; r <= Math.min(sh.maxRow, 6) && !hdr; r++) {
        const cols = {}; for (let c = 1; c <= sh.maxCol; c++) { const v = cell(sh, r, c); if (typeof v === 'string') cols[C.plain(v).trim()] = c; }
        if (cols.hostname && cols.interfaz && cols['salida fed']) hdr = { kind: 'fed', r, cols };
        else if (cols.ap && cols.puerto && cols.drops) hdr = { kind: 'ap', r, cols };
      }
      if (!hdr) continue;
      if (hdr.kind === 'fed') {
        const by = new Map(); let cur = null;
        for (let r = hdr.r + 1; r <= sh.maxRow; r++) {
          const host = cell(sh, r, hdr.cols.hostname);
          if (host) {
            const k = String(host).trim();
            if (!by.has(k)) by.set(k, { tipo: 'xlsx-fed', name: `${name} · ${k}`, host: k, ip: String(cell(sh, r, hdr.cols.ip) || '') || null, fecha: serial(cell(sh, r, hdr.cols['fecha consulta'])) || fechaNombre(name), sede: C.sedeDeHost(k) || C.sedeDeTexto(name), rows: [] });
            cur = { intf: C.intf(cell(sh, r, hdr.cols.interfaz)), lines: [] }; by.get(k).rows.push(cur);
          }
          const line = cell(sh, r, hdr.cols['salida fed']);
          if (cur && line !== null) cur.lines.push(line);
        }
        for (const f of by.values()) { f.rows = f.rows.map((x) => ({ intf: x.intf, ap: null, src: 'fed', ...contadores(x.lines) })); files.push(f); }
      } else {
        const sede = C.sedeDeTexto(sh.name) || C.sedeDeTexto(name);
        const rows = [];
        for (let r = hdr.r + 1; r <= sh.maxRow; r++) {
          const ap = cell(sh, r, hdr.cols.ap); if (!ap) continue;
          const d = Number(cell(sh, r, hdr.cols.drops));
          const puerto = cell(sh, r, hdr.cols.puerto);
          rows.push({ intf: String(ap).trim(), ap: puerto ? `Puerto ${C.intf(puerto)}` : null, src: 'ap', enq: [0, 0, 0, 0], drp: [0, 0, 0, Number.isFinite(d) && d > 0 ? Math.round(d) : 0], ok: Number.isFinite(d), err: Number.isFinite(d) ? null : 'La celda de drops no es un número.' });
        }
        if (rows.length) files.push({ tipo: 'xlsx-ap', name: `${name} · ${sh.name.trim()}`, host: `(sin switch) ${sede ? C.SEDE[sede].name : sh.name.trim()}`, ip: null, fecha: fechaNombre(name), sede, rows });
      }
    }
    if (!files.length) throw new HttpError(400, `${path.basename(name)}: no se reconoce el formato del Excel. Se esperan las columnas Hostname, Interfaz y Salida FED, o AP, Puerto y Drops.`);
    return files;
  }

  /** Un archivo subido (.zip, .txt o .xlsx) → lista de "switches" con sus interfaces. */
  function leer(buf, nombre) {
    const out = [], omitidos = [], errores = [];
    const uno = (name, data) => {
      const ext = path.extname(name).toLowerCase();
      try {
        if (ext === '.txt' || ext === '.log') { const f = parseTxt(data.toString('latin1'), name); if (f.rows.length) out.push(f); else omitidos.push(path.basename(name)); }
        else if (ext === '.xlsx') out.push(...parseXlsx(data, name));
      } catch (err) { errores.push(err instanceof HttpError ? err.message : `${path.basename(name)}: ${err.message}`); }
    };
    const ext = path.extname(nombre).toLowerCase();
    if (ext === '.zip') {
      let files;
      try { files = unzip(buf, (n) => !/(^|\/)(__MACOSX\/|\._|~\$)/.test(n) && /\.(txt|log|xlsx)$/i.test(n), 200 * 1024 * 1024, true); } catch (err) { throw new HttpError(400, `${nombre}: ${err.message}`); }
      if (!files.size) throw new HttpError(400, `${nombre}: el .zip no trae archivos .txt ni .xlsx.`);
      for (const [n, data] of files) uno(`${nombre}/${n}`, data);
    } else if (['.txt', '.log', '.xlsx'].includes(ext)) uno(nombre, buf);
    else throw new HttpError(400, `${nombre}: sube un archivo .zip, .txt o .xlsx.`);
    return { files: out, omitidos, errores };
  }

  /** Resumen de lo leído, para la vista previa y para guardar. */
  function plan(buf, nombre) {
    const leido = leer(buf, nombre); const { omitidos, errores } = leido; const rechazos = [];
    // (a) el archivo trae los contadores de otro switch (falló el salto desde el pivote)
    let files = leido.files.filter((f) => { if (!f.ajeno) return true; rechazos.push(`${f.host}${f.ip ? ` (${f.ip})` : ''}: el archivo trae los contadores de ${f.ajeno}, no de este switch (falló el salto${f.pivote ? ` desde el pivote ${f.pivote}` : ''}). No se carga; vuelve a capturarlo.`); return false; });
    // (b) el mismo switch desde dos IP distintas: una de las capturas es en realidad otro equipo que no se leyó
    const porHost = new Map(); for (const f of files) if (f.tipo === 'txt' && f.host && f.ip) { const k = f.host.toUpperCase(); if (!porHost.has(k)) porHost.set(k, []); porHost.get(k).push(f); }
    const fuera = new Set();
    for (const list of porHost.values()) {
      if (new Set(list.map((f) => f.ip)).size < 2) continue;
      const conocida = db.prepare('SELECT ip FROM qos_lecturas WHERE host = ? AND ip IS NOT NULL ORDER BY id DESC LIMIT 1').get(list[0].host);
      const buena = list.find((f) => f.pivote && f.ip === f.pivote) || list.find((f) => conocida && f.ip === conocida.ip) || list[0];
      for (const f of list) if (f !== buena) { fuera.add(f); rechazos.push(`${f.ip}: el archivo trae a ${f.host}, el mismo switch que ${buena.ip}. El equipo de ${f.ip} no se leyó; vuelve a capturarlo.`); }
    }
    files = files.filter((f) => !fuera.has(f));
    const fechas = new Map(); const sedes = new Map(); const sinSede = []; const errs = new Map();
    let interfaces = 0, sinLectura = 0, conDrops = 0, conFoco = 0;
    for (const f of files) {
      if (!f.sede) sinSede.push(f.host || path.basename(f.name));
      const s = f.sede || 'otra';
      if (f.fecha) fechas.set(f.fecha, (fechas.get(f.fecha) || 0) + f.rows.length);
      const a = sedes.get(s) || { sede: s, switches: 0, interfaces: 0 }; a.switches += f.tipo === 'xlsx-ap' ? 0 : 1; a.interfaces += f.rows.length; sedes.set(s, a);
      for (const r of f.rows) {
        interfaces += 1;
        if (!r.ok) { sinLectura += 1; const k = (r.err || '').replace(/(GigabitEthernet|TenGigabitEthernet|Interface)\s*\S*\d\S*/gi, '$1 …'); const e = errs.get(k) || { msg: k, n: 0, hosts: new Set() }; e.n += 1; e.hosts.add(f.host); errs.set(k, e); continue; }
        if (C.sum(r.drp) > 0) conDrops += 1;
        if (r.drp[0] + r.drp[1] + r.drp[2] > 0) conFoco += 1;
      }
    }
    const avisos = [];
    for (const e of errs.values()) {
      const pista = /Invalid input/i.test(e.msg) ? ' En los C9300 el comando necesita «fed switch active».' : /not found/i.test(e.msg) ? ' La interfaz no existe en el switch activo; revisa el número de miembro del stack.' : '';
      avisos.push(`${e.n} ${e.n === 1 ? 'interfaz sin lectura' : 'interfaces sin lectura'} en ${e.hosts.size} ${e.hosts.size === 1 ? 'switch' : 'switches'} (${[...e.hosts].slice(0, 3).join(', ')}${e.hosts.size > 3 ? '…' : ''}): «${e.msg}».${pista}`);
    }
    if (sinSede.length) avisos.push(`No se reconoce la sede de ${sinSede.length} ${sinSede.length === 1 ? 'switch' : 'switches'} (${sinSede.slice(0, 3).join(', ')}${sinSede.length > 3 ? '…' : ''}); se guardan como «Otra sede».`);
    if (omitidos.length) avisos.push(`${omitidos.length} ${omitidos.length === 1 ? 'archivo no trae' : 'archivos no traen'} interfaces hacia AP y se ${omitidos.length === 1 ? 'omite' : 'omiten'}.`);
    const fechaSugerida = [...fechas.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
    if (fechaSugerida) {
      const viejos = files.filter((f) => f.fecha && f.fecha < C.addDays(fechaSugerida[0], -DIAS_VIEJO));
      if (viejos.length) avisos.push(`${viejos.length} ${viejos.length === 1 ? 'switch trae' : 'switches traen'} contadores de otra fecha (${viejos.slice(0, 3).map((f) => `${f.host}: ${fechaTxt(f.fecha)}`).join(', ')}${viejos.length > 3 ? '…' : ''}). En un seguimiento no se cargan si son más de ${DIAS_VIEJO} días anteriores a la fecha de corte; vuelve a capturarlos.`);
    }
    avisos.unshift(...rechazos);
    return { files, resumen: { archivo: nombre, switches: files.filter((f) => f.tipo !== 'xlsx-ap').length, interfaces, sinLectura, conDrops, conFoco, sinClases: files.some((f) => f.tipo === 'xlsx-ap'),
      sedes: [...sedes.values()].sort((a, b) => b.interfaces - a.interfaces), fechas: [...fechas.entries()].map(([fecha, n]) => ({ fecha, n })).sort((a, b) => a.fecha.localeCompare(b.fecha)),
      fechaSugerida: fechaSugerida ? fechaSugerida[0] : null, rechazados: rechazos.length, tipoSugerido: esBase(nombre) ? 'base' : 'seguimiento', avisos, errores: interfaces ? errores : [...errores, `${nombre}: no se encontraron interfaces con contadores de colas.`], hayErrores: !interfaces } };
  }

  function guardar(p, fecha, tipo, user) {
    const ts = now();
    db.exec('BEGIN');
    try {
      let corte = db.prepare('SELECT id, tipo FROM qos_cortes WHERE fecha = ?').get(fecha);
      if (corte && corte.tipo !== tipo) throw new HttpError(409, `El corte del ${fechaTxt(fecha)} ya existe como «${C.TIPOS[corte.tipo]}». Elige el mismo tipo o elimina ese corte.`);
      if (!corte && tipo === 'base' && db.prepare("SELECT 1 FROM qos_cortes WHERE tipo = 'base'").get()) throw new HttpError(409, 'Ya existe una línea base con otra fecha. Usa esa misma fecha para agregarle archivos, o elimínala antes.');
      if (!corte) corte = { id: Number(db.prepare('INSERT INTO qos_cortes (fecha, tipo, created_by, created_at) VALUES (?,?,?,?)').run(fecha, tipo, user.id, ts).lastInsertRowid) };
      const carga = Number(db.prepare('INSERT INTO qos_cargas (corte_id, ts, user_id, archivo, resumen) VALUES (?,?,?,?,?)').run(corte.id, ts, user.id, p.resumen.archivo.slice(0, 200),
        JSON.stringify({ switches: p.resumen.switches, interfaces: p.resumen.interfaces, sinLectura: p.resumen.sinLectura, conDrops: p.resumen.conDrops, conFoco: p.resumen.conFoco, sedes: p.resumen.sedes })).lastInsertRowid);
      const up = db.prepare(`INSERT INTO qos_lecturas (corte_id, carga_id, sede, host, ip, intf, ap, src, ok, err, enq0, enq1, enq2, enq3, drp0, drp1, drp2, drp3) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (corte_id, host, intf) DO UPDATE SET carga_id = excluded.carga_id, sede = excluded.sede, ip = excluded.ip, ap = excluded.ap, src = excluded.src, ok = excluded.ok, err = excluded.err,
        enq0 = excluded.enq0, enq1 = excluded.enq1, enq2 = excluded.enq2, enq3 = excluded.enq3, drp0 = excluded.drp0, drp1 = excluded.drp1, drp2 = excluded.drp2, drp3 = excluded.drp3`);
      const borra = db.prepare('DELETE FROM qos_lecturas WHERE corte_id = ? AND host = ?');
      const files = p.files.filter((f) => !(tipo === 'seguimiento' && f.fecha && f.fecha < C.addDays(fecha, -DIAS_VIEJO)));
      // una nueva captura de un switch reemplaza todo lo que ese switch tenía en el corte
      for (const h of new Set(files.filter((f) => f.tipo !== 'xlsx-ap').map((f) => String(f.host || path.basename(f.name)).slice(0, 120)))) borra.run(corte.id, h);
      for (const f of files) for (const r of f.rows) up.run(corte.id, carga, f.sede || 'otra', String(f.host || path.basename(f.name)).slice(0, 120), f.ip, String(r.intf).slice(0, 80), r.ap, r.src, r.ok ? 1 : 0, r.err, ...r.enq, ...r.drp);
      db.exec('COMMIT');
      audit(user.id, 'qos_carga', { archivo: p.resumen.archivo, fecha, tipo, interfaces: p.resumen.interfaces });
      touch(); syncDef();
      return { corteId: corte.id, cargaId: carga, omitidosFecha: p.files.length - files.length };
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  /* ------------------------------------------------------------------ cálculo */
  const rawRows = (corteId) => db.prepare('SELECT sede, host, ip, intf, ap, src, ok, err, enq0, enq1, enq2, enq3, drp0, drp1, drp2, drp3 FROM qos_lecturas WHERE corte_id = ? ORDER BY sede, host, intf').all(corteId)
    .map((r) => ({ sede: r.sede, host: r.host, ip: r.ip, intf: r.intf, ap: r.ap, src: r.src, ok: !!r.ok, err: r.err, enq: [r.enq0, r.enq1, r.enq2, r.enq3], drp: [r.drp0, r.drp1, r.drp2, r.drp3] }));
  const listaCortes = () => db.prepare('SELECT c.id, c.fecha, c.tipo, c.created_at AS createdAt, u.name AS user FROM qos_cortes c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.fecha').all();

  /**
   * Interfaces de un corte con su pérdida "nueva" (nd) y su tráfico "nuevo" (ne):
   * - línea base o primer seguimiento: los contadores tal como vienen;
   * - seguimientos siguientes: contador actual − contador del seguimiento anterior, salvo que el switch lo haya reiniciado (entonces el actual).
   */
  function filas(corte) {
    const key = `f${corte.id}`;
    if (cache.has(key)) return cache.get(key);
    const rows = rawRows(corte.id);
    let prev = null;
    if (corte.tipo === 'seguimiento') {
      const p = db.prepare("SELECT id FROM qos_cortes WHERE tipo = 'seguimiento' AND fecha < ? ORDER BY fecha DESC LIMIT 1").get(corte.fecha);
      if (p) prev = new Map(rawRows(p.id).filter((r) => r.ok).map((r) => [`${r.host}|${r.intf}`, r]));
    }
    for (const r of rows) {
      const p = prev && r.ok ? prev.get(`${r.host}|${r.intf}`) : null;
      // Reinicio = baja algún contador de drops o más de una cola de enqueue. Si solo baja el enqueue de una cola y su valor
      // anterior cabía en 36 bits, el contador dio la vuelta (en 2^36 bytes ≈ 68.7 GB): se suma la vuelta y se sigue con la diferencia.
      const bajaE = p ? [0, 1, 2, 3].filter((q) => r.enq[q] < p.enq[q]) : [];
      const sigue = p && [0, 1, 2, 3].every((q) => r.drp[q] >= p.drp[q]) && (bajaE.length === 0 || (bajaE.length === 1 && p.enq[bajaE[0]] < VUELTA));
      r.modo = sigue ? 'delta' : p ? 'reinicio' : 'acumulado';
      r.vuelta = sigue && bajaE.length === 1;
      r.nd = sigue ? r.drp.map((v, q) => v - p.drp[q]) : r.drp.slice();
      r.ne = sigue ? r.enq.map((v, q) => v - p.enq[q] + (v < p.enq[q] ? VUELTA : 0)) : r.enq.slice();
      r.mal = r.ok && C.conPerdida(r, corte.tipo);
    }
    cache.set(key, rows);
    return rows;
  }
  function agrega(rows) {
    const a = { n: rows.length, read: 0, bad: 0, switches: new Set(), clases: [0, 1, 2, 3].map(() => ({ enq: 0, drp: 0, ifs: 0 })), drpFoco: 0 };
    for (const r of rows) {
      if (r.src === 'fed') a.switches.add(r.host);
      if (!r.ok) continue;
      a.read += 1; if (r.mal) a.bad += 1;
      for (let q = 0; q < 4; q++) { a.clases[q].enq += r.ne[q]; a.clases[q].drp += r.nd[q]; if (r.nd[q] > 0) a.clases[q].ifs += 1; }
      a.drpFoco += r.nd[0] + r.nd[1] + r.nd[2];
    }
    return { n: a.n, read: a.read, bad: a.bad, sinLectura: a.n - a.read, switches: a.switches.size, clases: a.clases, drpFoco: a.drpFoco, drpTotal: a.clases.reduce((x, c) => x + c.drp, 0), clean: a.read ? ((a.read - a.bad) / a.read) * 100 : null };
  }
  function resumenCortes() {
    if (cache.has('cortes')) return cache.get('cortes');
    const out = listaCortes().map((c) => {
      const rows = filas(c);
      const sedes = {};
      for (const s of new Set(rows.map((r) => r.sede))) sedes[s] = agrega(rows.filter((r) => r.sede === s));
      return { ...c, ...agrega(rows), sedes, delta: rows.filter((r) => r.modo === 'delta').length, reinicio: rows.filter((r) => r.modo === 'reinicio').length, sinClases: rows.filter((r) => r.src === 'ap').length };
    });
    cache.set('cortes', out);
    return out;
  }
  const objetivos = () => db.prepare('SELECT fecha, valor FROM qos_objetivos ORDER BY fecha').all();

  function datos() {
    const cortes = resumenCortes();
    const cargas = db.prepare('SELECT g.id, g.corte_id AS corteId, g.ts, g.archivo, g.resumen, u.name AS user, (SELECT COUNT(*) FROM qos_lecturas l WHERE l.carga_id = g.id) AS vigentes FROM qos_cargas g LEFT JOIN users u ON u.id = g.user_id ORDER BY g.id DESC LIMIT 80').all()
      .map((g) => ({ ...g, resumen: JSON.parse(g.resumen || '{}') }));
    return { hoy: today(), version, cortes, cargas, objetivos: objetivos(), inicial: C.META.inicial };
  }

  function weeklySummary() {
    const by = new Map();
    for (const c of resumenCortes()) if (c.tipo === 'seguimiento' && c.clean !== null) by.set(C.mondayOf(c.fecha), c); // el último corte de cada semana
    return [...by.entries()].map(([week, c]) => ({ week, fecha: c.fecha, clean: Math.round(c.clean * 100) / 100, bad: c.bad, n: c.n, read: c.read, sedes: Object.keys(c.sedes).length, switches: c.switches,
      limpias: Object.values(c.sedes).filter((s) => s.read && !s.bad).length, updatedAt: c.createdAt }));
  }

  /* ------------------------------------------------------------------ exportación */
  const csv = (rows) => '﻿' + rows.map((r) => r.map((v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
  const sedeN = (k) => (C.SEDE[k] ? C.SEDE[k].name : 'Otra sede');
  const sendCsv = (res, name, rows) => send(res, 200, csv(rows), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` });

  /* ------------------------------------------------------------------ API */
  const body = (req, max) => new Promise((resolve, reject) => { let size = 0; const ch = []; req.on('data', (c) => { size += c.length; if (size > max) { reject(new HttpError(413, `El archivo es demasiado grande (máximo ${Math.round(max / 1048576)} MB).`)); req.destroy(); } else ch.push(c); }); req.on('end', () => resolve(Buffer.concat(ch))); req.on('error', reject); });
  const corteDe = (id) => { const c = listaCortes().find((x) => x.id === Number(id)); if (!c) throw new HttpError(404, 'El corte no existe.'); return c; };

  async function handle(req, res, url, user) {
    const p = url.pathname, m = req.method;
    if (!p.startsWith('/api/qos/')) return false;
    if (p === '/api/qos/datos' && m === 'GET') return send(res, 200, datos()), true;

    if (p === '/api/qos/importar' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede cargar información.');
      const nombre = String(url.searchParams.get('nombre') || 'archivo').slice(0, 200);
      const guardarlo = url.searchParams.get('modo') === 'guardar';
      const pl = plan(await body(req, 60 * 1024 * 1024), nombre);
      if (!guardarlo) return send(res, 200, pl.resumen), true;
      if (pl.resumen.hayErrores) throw new HttpError(400, pl.resumen.errores.join(' '));
      const fecha = url.searchParams.get('fecha'), tipo = url.searchParams.get('tipo');
      if (!isDate(fecha) || fecha > today()) throw new HttpError(400, 'La fecha de corte no es válida o es futura.');
      if (!C.TIPOS[tipo]) throw new HttpError(400, 'Elige si la carga es la línea base o un seguimiento semanal.');
      return send(res, 200, { ...pl.resumen, ...guardar(pl, fecha, tipo, user) }), true;
    }

    let mm = p.match(/^\/api\/qos\/cortes\/(\d+)$/);
    if (mm && m === 'GET') {
      const c = corteDe(mm[1]);
      return send(res, 200, { corte: c, filas: filas(c).map((r) => ({ s: r.sede, h: r.host, ip: r.ip, i: r.intf, ap: r.ap, src: r.src, ok: r.ok, err: r.err, e: r.ne, d: r.nd, ea: r.enq, da: r.drp, modo: r.modo, mal: r.mal })) }), true;
    }
    if (mm && m === 'DELETE') {
      if (user.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede eliminar un corte.');
      const c = corteDe(mm[1]);
      db.prepare('DELETE FROM qos_lecturas WHERE corte_id = ?').run(c.id); db.prepare('DELETE FROM qos_cargas WHERE corte_id = ?').run(c.id); db.prepare('DELETE FROM qos_cortes WHERE id = ?').run(c.id);
      audit(user.id, 'qos_corte_eliminado', { fecha: c.fecha, tipo: c.tipo }); touch(); syncDef();
      return send(res, 200, { ok: true }), true;
    }
    mm = p.match(/^\/api\/qos\/cargas\/(\d+)$/);
    if (mm && m === 'DELETE') {
      if (user.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede deshacer una carga.');
      const g = db.prepare('SELECT id, corte_id, archivo FROM qos_cargas WHERE id = ?').get(Number(mm[1]));
      if (!g) throw new HttpError(404, 'La carga no existe.');
      const n = db.prepare('DELETE FROM qos_lecturas WHERE carga_id = ?').run(g.id).changes;
      db.prepare('DELETE FROM qos_cargas WHERE id = ?').run(g.id);
      if (!db.prepare('SELECT 1 FROM qos_lecturas WHERE corte_id = ?').get(g.corte_id)) { db.prepare('DELETE FROM qos_cargas WHERE corte_id = ?').run(g.corte_id); db.prepare('DELETE FROM qos_cortes WHERE id = ?').run(g.corte_id); }
      audit(user.id, 'qos_carga_deshecha', { archivo: g.archivo, lecturas: Number(n) }); touch(); syncDef();
      return send(res, 200, { ok: true, borradas: Number(n) }), true;
    }

    if (p === '/api/qos/interfaz' && m === 'GET') {
      const host = String(url.searchParams.get('host') || ''), intf = String(url.searchParams.get('intf') || '');
      const out = [];
      for (const c of listaCortes()) { const r = filas(c).find((x) => x.host === host && x.intf === intf); if (r) out.push({ fecha: c.fecha, tipo: c.tipo, ok: r.ok, err: r.err, e: r.ne, d: r.nd, ea: r.enq, da: r.drp, modo: r.modo, mal: r.mal }); }
      return send(res, 200, { host, intf, historial: out }), true;
    }

    if (p === '/api/qos/objetivos' && m === 'PUT') {
      if (user.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede cambiar los objetivos.');
      const b = await readJson(req);
      const list = Array.isArray(b.objetivos) ? b.objetivos : [];
      if (!list.length || list.length > 36) throw new HttpError(400, 'Escribe al menos un objetivo mensual.');
      const seen = new Set();
      const rows = list.map((o, i) => {
        const v = Number(o.valor);
        if (!isDate(o.fecha)) throw new HttpError(400, `Objetivo ${i + 1}: la fecha no es válida.`);
        if (!Number.isFinite(v) || v < 0 || v > 100) throw new HttpError(400, `Objetivo ${i + 1}: el valor debe estar entre 0 y 100.`);
        if (seen.has(o.fecha)) throw new HttpError(400, `Hay dos objetivos con la fecha ${fechaTxt(o.fecha)}.`);
        seen.add(o.fecha);
        return { fecha: o.fecha, valor: Math.round(v * 100) / 100 };
      }).sort((a, b2) => a.fecha.localeCompare(b2.fecha));
      for (let i = 1; i < rows.length; i++) if (rows[i].valor < rows[i - 1].valor) throw new HttpError(400, 'Los objetivos deben ir en aumento: cada mes igual o mayor que el anterior.');
      db.exec('BEGIN');
      try { db.prepare('DELETE FROM qos_objetivos').run(); const ins = db.prepare('INSERT INTO qos_objetivos (fecha, valor) VALUES (?,?)'); for (const o of rows) ins.run(o.fecha, o.valor); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }
      audit(user.id, 'qos_objetivos', { objetivos: rows }); touch(); syncDef();
      return send(res, 200, { objetivos: rows }), true;
    }

    if (p === '/api/qos/export/semanal.csv' && m === 'GET') {
      const rows = [['Corte', 'Tipo', 'Sede', 'Interfaces hacia AP', 'Leídas', 'Sin lectura', 'Con pérdida', '% sin pérdida', 'Voice con pérdida', 'Video con pérdida', 'Signaling con pérdida', 'class-default con descarte', 'Descartado Voice (bytes)', 'Descartado Video (bytes)', 'Descartado Signaling (bytes)', 'Descartado class-default (bytes)']];
      for (const c of resumenCortes()) {
        const line = (name, a) => rows.push([c.fecha, C.TIPOS[c.tipo], name, a.n, a.read, a.sinLectura, a.bad, a.clean === null ? '' : a.clean.toFixed(2), ...a.clases.map((x) => x.ifs), ...a.clases.map((x) => x.drp)]);
        line('Todas las sedes', c);
        for (const [k, a] of Object.entries(c.sedes).sort((x, y) => sedeN(x[0]).localeCompare(sedeN(y[0])))) line(sedeN(k), a);
      }
      return sendCsv(res, 'qos-wlan-semanal.csv', rows), true;
    }
    if (p === '/api/qos/export/interfaces.csv' && m === 'GET') {
      const cs = listaCortes(); if (!cs.length) throw new HttpError(404, 'Aún no hay cortes cargados.');
      const c = url.searchParams.get('corte') ? corteDe(url.searchParams.get('corte')) : cs[cs.length - 1];
      const rows = [['Corte', 'Sede', 'Switch', 'IP', 'Interfaz', 'Estado', 'Cálculo', 'Voice descartado (bytes)', 'Video descartado (bytes)', 'Signaling descartado (bytes)', 'class-default descartado (bytes)', 'Voice cursado (bytes)', 'Video cursado (bytes)', 'Signaling cursado (bytes)', 'class-default cursado (bytes)', 'Detalle']];
      for (const r of filas(c)) rows.push([c.fecha, sedeN(r.sede), r.host, r.ip, r.intf, !r.ok ? 'Sin lectura' : r.mal ? 'Con pérdida' : 'Sin pérdida', r.modo === 'delta' ? 'Desde la carga anterior' : r.modo === 'reinicio' ? 'Contador reiniciado' : 'Acumulado', ...r.nd, ...r.ne, r.err || r.ap || '']);
      return sendCsv(res, `qos-wlan-interfaces-${c.fecha}.csv`, rows), true;
    }
    return false;
  }

  return { handle, ensure, weeklySummary };
};
