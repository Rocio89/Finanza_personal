const express = require('express');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'finanzas.db');

fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(dbPath);

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function initDatabase() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS movimientos (
      id TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      categoria TEXT NOT NULL,
      descripcion TEXT,
      monto REAL NOT NULL,
      fecha TEXT NOT NULL,
      mes TEXT NOT NULL,
      recurrente INTEGER NOT NULL DEFAULT 0
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS tarjetas (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      saldo REAL NOT NULL,
      tasa REAL NOT NULL,
      minimo REAL NOT NULL
    )
  `);

  await dbRun(`
    INSERT OR IGNORE INTO config (key, value) VALUES ('moneda', '$')
  `);

  await dbRun(`
    INSERT OR IGNORE INTO config (key, value) VALUES ('presupuestoDeuda', '0')
  `);
}

function normalizeState(payload = {}) {
  const safe = {
    moneda: '$',
    movimientos: [],
    tarjetas: [],
    presupuestoDeuda: 0,
  };

  if (payload.moneda) safe.moneda = String(payload.moneda);
  safe.presupuestoDeuda = Number(payload.presupuestoDeuda) || 0;

  safe.movimientos = Array.isArray(payload.movimientos) ? payload.movimientos.map((m) => ({
    id: String(m.id || ''),
    tipo: String(m.tipo || 'ingreso'),
    categoria: String(m.categoria || ''),
    descripcion: String(m.descripcion || ''),
    monto: Number(m.monto) || 0,
    fecha: String(m.fecha || new Date().toISOString().slice(0, 10)),
    mes: String(m.mes || (String(m.fecha || '').slice(0, 7) || new Date().toISOString().slice(0, 7))),
    recurrente: Boolean(Number(m.recurrente) || m.recurrente === true),
  })).filter((m) => m.id && m.categoria && m.monto >= 0) : [];

  safe.tarjetas = Array.isArray(payload.tarjetas) ? payload.tarjetas.map((c) => ({
    id: String(c.id || ''),
    nombre: String(c.nombre || ''),
    saldo: Number(c.saldo) || 0,
    tasa: Number(c.tasa) || 0,
    minimo: Number(c.minimo) || 0,
  })).filter((c) => c.id && c.nombre) : [];

  return safe;
}

async function readState() {
  const [monedaRow, deudaRow, movimientosRows, tarjetasRows] = await Promise.all([
    dbGet("SELECT value FROM config WHERE key = 'moneda'"),
    dbGet("SELECT value FROM config WHERE key = 'presupuestoDeuda'"),
    dbAll('SELECT * FROM movimientos ORDER BY fecha ASC, categoria ASC'),
    dbAll('SELECT * FROM tarjetas ORDER BY nombre ASC'),
  ]);

  return normalizeState({
    moneda: monedaRow ? monedaRow.value : '$',
    presupuestoDeuda: deudaRow ? Number(deudaRow.value) || 0 : 0,
    movimientos: movimientosRows.map((m) => ({
      ...m,
      recurrente: Number(m.recurrente) === 1,
    })),
    tarjetas: tarjetasRows,
  });
}

async function saveState(payload) {
  const state = normalizeState(payload);

  await dbRun('BEGIN IMMEDIATE');

  try {
    await dbRun('DELETE FROM movimientos');
    await dbRun('DELETE FROM tarjetas');

    for (const movimiento of state.movimientos) {
      await dbRun(
        'INSERT INTO movimientos (id, tipo, categoria, descripcion, monto, fecha, mes, recurrente) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          movimiento.id,
          movimiento.tipo,
          movimiento.categoria,
          movimiento.descripcion,
          Number(movimiento.monto),
          movimiento.fecha,
          movimiento.mes,
          movimiento.recurrente ? 1 : 0,
        ]
      );
    }

    for (const tarjeta of state.tarjetas) {
      await dbRun(
        'INSERT INTO tarjetas (id, nombre, saldo, tasa, minimo) VALUES (?, ?, ?, ?, ?)',
        [tarjeta.id, tarjeta.nombre, Number(tarjeta.saldo), Number(tarjeta.tasa), Number(tarjeta.minimo)]
      );
    }

    await dbRun(
      "INSERT INTO config (key, value) VALUES ('moneda', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [state.moneda]
    );

    await dbRun(
      "INSERT INTO config (key, value) VALUES ('presupuestoDeuda', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [String(state.presupuestoDeuda)]
    );

    await dbRun('COMMIT');
  } catch (error) {
    await dbRun('ROLLBACK');
    throw error;
  }
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'API funcionando' });
});

app.get('/api/state', async (req, res) => {
  try {
    const state = await readState();
    res.json(state);
  } catch (error) {
    console.error('Error al leer estado:', error);
    res.status(500).json({ error: 'No se pudo leer la base de datos' });
  }
});

app.post('/api/state', async (req, res) => {
  try {
    await saveState(req.body || {});
    res.json({ ok: true });
  } catch (error) {
    console.error('Error al guardar estado:', error);
    res.status(500).json({ error: 'No se pudo guardar la base de datos' });
  }
});

const PORT = process.env.PORT || 3000;

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor activo en http://localhost:${PORT}`);
      console.log(`Base de datos creada en ${dbPath}`);
    });
  })
  .catch((error) => {
    console.error('No se pudo inicializar la base de datos:', error);
    process.exit(1);
  });
