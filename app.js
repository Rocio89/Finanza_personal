'use strict';

// ---------- Estado y almacenamiento ----------
const STORAGE_KEY = 'mis-finanzas-v1';
const TIPOS = {
  ingreso:   { label: 'Ingreso',        grupo: 'ingresos' },
  fijo:      { label: 'Gasto fijo',     grupo: 'gastos' },
  variable:  { label: 'Gasto variable', grupo: 'gastos' },
  ahorro:    { label: 'Ahorro',         grupo: 'ahorro' },
  inversion: { label: 'Inversión',      grupo: 'ahorro' },
};
const CATEGORIAS_BASE = {
  ingreso: ['Sueldo', 'Freelance', 'Bonos', 'Rentas', 'Otros ingresos'],
  fijo: ['Alquiler / Hipoteca', 'Servicios (luz, agua, gas)', 'Internet / Teléfono', 'Seguros', 'Educación', 'Suscripciones', 'Transporte', 'Pago de tarjeta', 'Préstamos'],
  variable: ['Comida / Supermercado', 'Restaurantes', 'Salud', 'Ropa', 'Entretenimiento', 'Viajes', 'Regalos', 'Hogar', 'Otros gastos'],
  ahorro: ['Fondo de emergencia', 'Meta: viaje', 'Meta: casa', 'Cuenta de ahorro'],
  inversion: ['Acciones / ETFs', 'Fondos mutuos', 'Plazo fijo', 'Cripto', 'Fondo de pensiones', 'Negocio'],
};

function defaultState() {
  return { moneda: '$', movimientos: [], tarjetas: [], presupuestoDeuda: 0 };
}

async function loadState() {
  try {
    const response = await fetch('/api/state', { headers: { Accept: 'application/json' } });
    if (response.ok) {
      const data = await response.json();
      state = Object.assign(defaultState(), data);
      return;
    }
  } catch (e) {
    console.warn('No se pudo cargar la base de datos, usando almacenamiento local.', e);
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = Object.assign(defaultState(), JSON.parse(raw));
    else state = defaultState();
  } catch (e) {
    console.warn('No se pudo leer el almacenamiento local', e);
    state = defaultState();
  }
}

async function saveState() {
  try {
    const response = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (!response.ok) throw new Error('Fallo al guardar');
  } catch (e) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (err) { alert('No se pudo guardar. Exporta un respaldo para no perder datos.'); }
  }
}

let state = defaultState();
let currentMonth = toMonthKey(new Date());
let editingMovId = null;
let editingCardId = null;

// ---------- Utilidades ----------
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function toMonthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  return toMonthKey(new Date(y, m - 1 + delta, 1));
}
function monthLabel(key, short) {
  const [y, m] = key.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('es', { month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function money(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '-' : '') + state.moneda + ' ' + Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(n) { return isFinite(n) ? (n * 100).toFixed(1) + '%' : '—'; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function totalsFor(month) {
  const t = { ingreso: 0, fijo: 0, variable: 0, ahorro: 0, inversion: 0 };
  state.movimientos.filter(m => m.mes === month).forEach(m => { t[m.tipo] += Number(m.monto) || 0; });
  t.gastos = t.fijo + t.variable;
  t.ahorroTotal = t.ahorro + t.inversion;
  t.disponible = t.ingreso - t.gastos - t.ahorroTotal;
  t.tasaAhorro = t.ingreso ? t.ahorroTotal / t.ingreso : NaN;
  return t;
}
function monthsWithData() {
  return [...new Set(state.movimientos.map(m => m.mes))].sort();
}

// ---------- Navegación ----------
document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
  if (btn.dataset.tab === 'evolucion') renderChart();
}));

function setMonth(key) {
  currentMonth = key;
  $('#monthInput').value = key;
  resetMovForm();
  renderAll();
}
$('#monthInput').addEventListener('change', e => { if (e.target.value) setMonth(e.target.value); });
$('#prevMonth').addEventListener('click', () => setMonth(shiftMonth(currentMonth, -1)));
$('#nextMonth').addEventListener('click', () => setMonth(shiftMonth(currentMonth, 1)));

$('#currencyInput').addEventListener('input', e => { state.moneda = e.target.value || '$'; saveState(); renderAll(); });

// ---------- Movimientos ----------
function updateCategoryList() {
  const tipo = $('#movTipo').value;
  const usadas = state.movimientos.filter(m => m.tipo === tipo).map(m => m.categoria);
  const cats = [...new Set([...CATEGORIAS_BASE[tipo], ...usadas])];
  $('#catList').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
}
$('#movTipo').addEventListener('change', updateCategoryList);

function defaultDateForMonth() {
  const today = new Date();
  return toMonthKey(today) === currentMonth ? today.toISOString().slice(0, 10) : currentMonth + '-01';
}
function resetMovForm() {
  editingMovId = null;
  $('#movForm').reset();
  $('#movFecha').value = defaultDateForMonth();
  $('#movSubmit').textContent = 'Agregar';
  $('#movCancel').hidden = true;
  updateCategoryList();
}
$('#movCancel').addEventListener('click', resetMovForm);

$('#movForm').addEventListener('submit', e => {
  e.preventDefault();
  const fecha = $('#movFecha').value;
  const data = {
    tipo: $('#movTipo').value,
    categoria: $('#movCategoria').value.trim(),
    descripcion: $('#movDesc').value.trim(),
    monto: parseFloat($('#movMonto').value),
    fecha,
    mes: fecha.slice(0, 7),
    recurrente: $('#movRecurrente').checked,
  };
  if (!data.categoria || !(data.monto >= 0)) return;
  if (editingMovId) {
    Object.assign(state.movimientos.find(m => m.id === editingMovId), data);
  } else {
    state.movimientos.push({ id: uid(), ...data });
  }
  saveState();
  if (data.mes !== currentMonth) setMonth(data.mes); else { resetMovForm(); renderAll(); }
});

$('#movFilter').addEventListener('change', renderMovimientos);

$('#movTable').addEventListener('click', e => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (e.target.dataset.action === 'del') {
    if (!confirm('¿Eliminar este movimiento?')) return;
    state.movimientos = state.movimientos.filter(m => m.id !== id);
    saveState(); renderAll();
  } else if (e.target.dataset.action === 'edit') {
    const m = state.movimientos.find(x => x.id === id);
    editingMovId = id;
    $('#movTipo').value = m.tipo; updateCategoryList();
    $('#movCategoria').value = m.categoria;
    $('#movDesc').value = m.descripcion || '';
    $('#movMonto').value = m.monto;
    $('#movFecha').value = m.fecha;
    $('#movRecurrente').checked = !!m.recurrente;
    $('#movSubmit').textContent = 'Guardar cambios';
    $('#movCancel').hidden = false;
    $('#movForm').scrollIntoView({ behavior: 'smooth' });
  }
});

$('#copyRecurring').addEventListener('click', () => {
  const prev = shiftMonth(currentMonth, -1);
  const recurrentes = state.movimientos.filter(m => m.mes === prev && m.recurrente);
  if (!recurrentes.length) { alert(`No hay movimientos marcados como "se repite" en ${monthLabel(prev)}.`); return; }
  const existentes = state.movimientos.filter(m => m.mes === currentMonth);
  let n = 0;
  recurrentes.forEach(r => {
    const dup = existentes.some(x => x.tipo === r.tipo && x.categoria === r.categoria && x.descripcion === r.descripcion);
    if (dup) return;
    const day = r.fecha.slice(8, 10);
    const [y, mo] = currentMonth.split('-').map(Number);
    const lastDay = new Date(y, mo, 0).getDate();
    const fecha = currentMonth + '-' + String(Math.min(Number(day), lastDay)).padStart(2, '0');
    state.movimientos.push({ ...r, id: uid(), fecha, mes: currentMonth });
    n++;
  });
  saveState(); renderAll();
  alert(n ? `Se copiaron ${n} movimientos. Ajusta los montos si cambiaron.` : 'Los recurrentes ya estaban copiados.');
});

function renderMovimientos() {
  const filtro = $('#movFilter').value;
  const rows = state.movimientos
    .filter(m => m.mes === currentMonth && (!filtro || m.tipo === filtro))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  $('#movTable tbody').innerHTML = rows.map(m => `
    <tr>
      <td>${esc(m.fecha.slice(8, 10) + '/' + m.fecha.slice(5, 7))}</td>
      <td><span class="badge">${TIPOS[m.tipo].label}</span>${m.recurrente ? ' <span class="muted small" title="Se repite cada mes">↻</span>' : ''}</td>
      <td>${esc(m.categoria)}</td>
      <td class="muted">${esc(m.descripcion)}</td>
      <td class="num ${m.tipo === 'ingreso' ? 'pos' : ''}">${money(m.monto)}</td>
      <td class="num">
        <button class="link-btn" data-action="edit" data-id="${m.id}">Editar</button>
        <button class="link-btn danger" data-action="del" data-id="${m.id}">Eliminar</button>
      </td>
    </tr>`).join('');
  $('#movEmpty').hidden = rows.length > 0;
  $('#movTable').hidden = rows.length === 0;
}

// ---------- Resumen ----------
function renderResumen() {
  const t = totalsFor(currentMonth);
  const prev = totalsFor(shiftMonth(currentMonth, -1));
  const acumulado = state.movimientos
    .filter(m => (m.tipo === 'ahorro' || m.tipo === 'inversion') && m.mes <= currentMonth)
    .reduce((s, m) => s + Number(m.monto), 0);

  const tile = (label, value, sub, color, cls = '') => `
    <div class="tile">
      <div class="label">${color ? `<span class="dot" style="background:var(${color})"></span>` : ''}${label}</div>
      <div class="value ${cls}">${value}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>`;
  $('#tiles').innerHTML = [
    tile('Ingresos', money(t.ingreso), monthLabel(currentMonth), '--series-1'),
    tile('Gastos fijos', money(t.fijo), t.ingreso ? pct(t.fijo / t.ingreso) + ' de tus ingresos' : '', '--series-2'),
    tile('Gastos variables', money(t.variable), t.ingreso ? pct(t.variable / t.ingreso) + ' de tus ingresos' : '', '--series-2'),
    tile('Ahorro + inversión', money(t.ahorroTotal), `Ahorro ${money(t.ahorro)} · Inversión ${money(t.inversion)}`, '--series-3'),
    tile('Disponible', money(t.disponible), t.disponible < 0 ? 'Gastaste más de lo que ingresó' : 'Sin asignar este mes', null, t.disponible < 0 ? 'neg' : 'pos'),
    tile('Ahorro acumulado', money(acumulado), 'Ahorro + inversión hasta este mes', '--series-3'),
  ].join('');

  // Gastos por categoría
  const porCat = {};
  state.movimientos.filter(m => m.mes === currentMonth && (m.tipo === 'fijo' || m.tipo === 'variable'))
    .forEach(m => { porCat[m.categoria] = (porCat[m.categoria] || 0) + Number(m.monto); });
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? cats[0][1] : 0;
  $('#categoryBars').innerHTML = cats.length ? cats.map(([c, v]) => `
    <div class="hbar">
      <div class="hbar-top"><span>${esc(c)}</span><span class="num">${money(v)} <span class="muted">(${pct(v / t.gastos)})</span></span></div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${(v / max) * 100}%"></div></div>
    </div>`).join('') : '<p class="muted">Sin gastos registrados este mes.</p>';

  // 50/30/20
  const bar = (label, val, meta, cls) => {
    const p = t.ingreso ? val / t.ingreso : 0;
    return `<div class="hbar">
      <div class="hbar-top"><span>${label}</span><span class="num">${pct(p)} <span class="muted">(meta ${meta})</span></span></div>
      <div class="hbar-track"><div class="hbar-fill ${cls}" style="width:${Math.min(p, 1) * 100}%"></div></div>
    </div>`;
  };
  $('#ruleBars').innerHTML = t.ingreso
    ? bar('Gastos fijos (necesidades)', t.fijo, '≤ 50%', 'need') + bar('Gastos variables (gustos)', t.variable, '≤ 30%', '') + bar('Ahorro + inversión', t.ahorroTotal, '≥ 20%', 'save')
    : '<p class="muted">Registra tus ingresos del mes para ver la distribución.</p>';

  // Comparación con el mes anterior
  const prevKey = shiftMonth(currentMonth, -1);
  if (prev.gastos || prev.ingreso) {
    const diff = t.gastos - prev.gastos;
    const rel = prev.gastos ? diff / prev.gastos : NaN;
    $('#monthCompare').innerHTML = `Frente a <strong>${monthLabel(prevKey)}</strong> gastaste
      <strong class="${diff > 0 ? 'neg' : 'pos'}">${diff >= 0 ? '+' : ''}${money(diff)}</strong>
      ${isFinite(rel) ? `(${diff >= 0 ? '+' : ''}${pct(rel)})` : ''} ${diff > 0 ? '▲ más' : diff < 0 ? '▼ menos' : 'lo mismo'}.`;
  } else {
    $('#monthCompare').innerHTML = `<span class="muted">No hay datos de ${monthLabel(prevKey)} para comparar.</span>`;
  }
}

// ---------- Evolución mes a mes ----------
const SERIES = [
  { key: 'ingreso',     label: 'Ingresos',           color: '--series-1' },
  { key: 'gastos',      label: 'Gastos (fijos + variables)', color: '--series-2' },
  { key: 'ahorroTotal', label: 'Ahorro + inversión', color: '--series-3' },
];
function chartMonths() {
  const meses = monthsWithData();
  if (!meses.includes(currentMonth)) meses.push(currentMonth);
  meses.sort();
  // Hasta 12 meses terminando en el mes seleccionado (o el último con datos)
  const end = meses.filter(m => m <= currentMonth).pop() || currentMonth;
  const list = [];
  for (let i = 11; i >= 0; i--) list.push(shiftMonth(end, -i));
  const first = meses[0];
  return list.filter(m => m >= first);
}

function renderChart() {
  const el = $('#chart');
  if (!el.offsetParent) return; // pestaña oculta
  $('#chartLegend').innerHTML = SERIES.map(s => `<span><span class="dot" style="background:var(${s.color})"></span>${s.label}</span>`).join('');
  const months = chartMonths();
  const data = months.map(m => ({ mes: m, ...totalsFor(m) }));
  const W = Math.max(el.clientWidth, 300), H = 280;
  const pad = { t: 10, r: 8, b: 28, l: 64 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const maxV = Math.max(1, ...data.flatMap(d => SERIES.map(s => d[s.key])));
  const step = niceStep(maxV / 4);
  const yMax = Math.ceil(maxV / step) * step;
  const y = v => pad.t + ih - (v / yMax) * ih;
  const colW = iw / data.length;
  const barW = Math.max(3, Math.min(22, (colW * 0.7 - 4) / 3));
  const groupW = barW * 3 + 4;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos, gastos y ahorro por mes">`;
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/>`;
    svg += `<text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${shortMoney(v)}</text>`;
  }
  data.forEach((d, i) => {
    const gx = pad.l + i * colW + (colW - groupW) / 2;
    SERIES.forEach((s, j) => {
      const v = d[s.key];
      if (v <= 0) return;
      const x = gx + j * (barW + 2), top = y(v), h = pad.t + ih - top;
      const r = Math.min(4, barW / 2, h);
      svg += `<path d="M${x},${pad.t + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${pad.t + ih} Z" fill="var(${s.color})"/>`;
    });
    const showLabel = data.length <= 8 || i % 2 === (data.length - 1) % 2;
    if (showLabel) svg += `<text x="${pad.l + i * colW + colW / 2}" y="${H - 8}" text-anchor="middle" ${d.mes === currentMonth ? 'style="fill:var(--text-primary);font-weight:700"' : ''}>${monthLabel(d.mes, true)}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${pad.l + i * colW}" y="${pad.t}" width="${colW}" height="${ih}" fill="transparent"/>`;
  });
  svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="var(--text-muted)" stroke-width="1"/></svg>`;
  el.innerHTML = svg;

  const tip = $('#tooltip');
  el.querySelectorAll('.hit').forEach(rect => {
    rect.addEventListener('mousemove', ev => {
      const d = data[rect.dataset.i];
      tip.innerHTML = `<strong>${monthLabel(d.mes)}</strong>` + SERIES.map(s =>
        `<div class="row"><span><span class="dot" style="background:var(${s.color})"></span>${s.label}</span><span class="num">${money(d[s.key])}</span></div>`).join('') +
        `<div class="row"><span>Disponible</span><span class="num ${d.disponible < 0 ? 'neg' : ''}">${money(d.disponible)}</span></div>`;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      const left = ev.clientX + 14 + tw > window.innerWidth ? ev.clientX - tw - 14 : ev.clientX + 14;
      tip.style.left = left + 'px';
      tip.style.top = (ev.clientY + 14) + 'px';
      rect.setAttribute('fill', 'var(--grid)'); rect.setAttribute('fill-opacity', '0.35');
    });
    rect.addEventListener('mouseleave', () => { tip.hidden = true; rect.setAttribute('fill', 'transparent'); });
  });
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function shortMoney(v) {
  if (v >= 1e6) return state.moneda + (v / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (v >= 1e3) return state.moneda + (v / 1e3).toFixed(1).replace('.0', '') + 'k';
  return state.moneda + v;
}

function renderEvolucionTable() {
  const meses = monthsWithData().reverse();
  $('#evoTable tbody').innerHTML = meses.length ? meses.map(m => {
    const t = totalsFor(m), p = totalsFor(shiftMonth(m, -1));
    const diff = t.gastos - p.gastos;
    const cmp = p.gastos ? `<span class="${diff > 0 ? 'neg' : 'pos'}">${diff > 0 ? '▲' : diff < 0 ? '▼' : ''} ${pct(diff / p.gastos)}</span>` : '<span class="muted">—</span>';
    return `<tr${m === currentMonth ? ' style="font-weight:600"' : ''}>
      <td>${monthLabel(m)}</td><td class="num">${money(t.ingreso)}</td><td class="num">${money(t.fijo)}</td>
      <td class="num">${money(t.variable)}</td><td class="num">${money(t.ahorro)}</td><td class="num">${money(t.inversion)}</td>
      <td class="num ${t.disponible < 0 ? 'neg' : ''}">${money(t.disponible)}</td><td class="num">${pct(t.tasaAhorro)}</td><td class="num">${cmp}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="muted">Aún no hay datos.</td></tr>';
}

// ---------- Tarjetas y estrategias de pago ----------
function resetCardForm() {
  editingCardId = null;
  $('#cardForm').reset();
  $('#cardSubmit').textContent = 'Agregar tarjeta';
  $('#cardCancel').hidden = true;
}
$('#cardCancel').addEventListener('click', resetCardForm);
$('#cardForm').addEventListener('submit', e => {
  e.preventDefault();
  const data = {
    nombre: $('#cardNombre').value.trim(),
    saldo: parseFloat($('#cardSaldo').value),
    tasa: parseFloat($('#cardTasa').value),
    minimo: parseFloat($('#cardMinimo').value),
  };
  if (editingCardId) Object.assign(state.tarjetas.find(c => c.id === editingCardId), data);
  else state.tarjetas.push({ id: uid(), ...data });
  saveState(); resetCardForm(); renderTarjetas();
});
$('#cardTable').addEventListener('click', e => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (e.target.dataset.action === 'del') {
    if (!confirm('¿Eliminar esta tarjeta?')) return;
    state.tarjetas = state.tarjetas.filter(c => c.id !== id);
    saveState(); renderTarjetas();
  } else {
    const c = state.tarjetas.find(x => x.id === id);
    editingCardId = id;
    $('#cardNombre').value = c.nombre; $('#cardSaldo').value = c.saldo;
    $('#cardTasa').value = c.tasa; $('#cardMinimo').value = c.minimo;
    $('#cardSubmit').textContent = 'Guardar cambios'; $('#cardCancel').hidden = false;
  }
});
$('#debtBudget').addEventListener('input', e => {
  state.presupuestoDeuda = parseFloat(e.target.value) || 0;
  saveState(); renderStrategies();
});

/**
 * Simula el pago mes a mes.
 * strategy: 'snowball' (menor saldo primero), 'avalanche' (mayor tasa primero), 'minimum' (solo mínimos).
 * La tasa se toma como anual nominal: interés mensual = tasa / 12.
 */
function simulate(cards, budget, strategy) {
  const debts = cards.map(c => ({ ...c, bal: Number(c.saldo), paidOffMonth: null, interest: 0, firstPayment: 0 }));
  const MAX = 600;
  let month = 0, totalInterest = 0, totalPaid = 0;
  const alive = () => debts.filter(d => d.bal > 0.005);
  const order = () => {
    const a = alive();
    if (strategy === 'snowball') a.sort((x, y) => x.bal - y.bal || y.tasa - x.tasa);
    if (strategy === 'avalanche') a.sort((x, y) => y.tasa - x.tasa || x.bal - y.bal);
    return a;
  };
  while (alive().length && month < MAX) {
    month++;
    // 1. Intereses del mes
    alive().forEach(d => { const i = d.bal * (d.tasa / 100 / 12); d.bal += i; d.interest += i; totalInterest += i; });
    // 2. Pagos mínimos
    let cash = strategy === 'minimum' ? Infinity : budget;
    const pay = (d, amount) => {
      const p = Math.min(amount, d.bal);
      d.bal -= p; totalPaid += p;
      if (month === 1) d.firstPayment += p;
      if (d.bal <= 0.005) { d.bal = 0; d.paidOffMonth = month; }
      return p;
    };
    alive().forEach(d => { cash -= pay(d, Math.min(d.minimo, cash)); });
    // 3. Extra a la deuda objetivo (y lo que sobre, a la siguiente)
    if (strategy !== 'minimum') {
      for (const d of order()) { if (cash <= 0.005) break; cash -= pay(d, cash); }
    }
  }
  return {
    months: month,
    finished: !alive().length,
    totalInterest, totalPaid,
    order: [...debts].sort((a, b) => (a.paidOffMonth ?? 1e9) - (b.paidOffMonth ?? 1e9)),
    debts,
  };
}

function monthsToText(n) {
  const y = Math.floor(n / 12), m = n % 12;
  return [y ? `${y} año${y > 1 ? 's' : ''}` : '', m ? `${m} mes${m > 1 ? 'es' : ''}` : ''].filter(Boolean).join(' y ') || '0 meses';
}
function payoffDate(n) { return monthLabel(shiftMonth(toMonthKey(new Date()), n - 1)); }

function renderTarjetas() {
  $('#cardTable tbody').innerHTML = state.tarjetas.length ? state.tarjetas.map(c => `
    <tr><td>${esc(c.nombre)}</td><td class="num">${money(c.saldo)}</td><td class="num">${Number(c.tasa).toFixed(2)}%</td>
    <td class="num">${money(c.minimo)}</td>
    <td class="num"><button class="link-btn" data-action="edit" data-id="${c.id}">Editar</button>
    <button class="link-btn danger" data-action="del" data-id="${c.id}">Eliminar</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">Agrega tus tarjetas o deudas para calcular la mejor estrategia.</td></tr>';
  $('#debtBudget').value = state.presupuestoDeuda || '';
  renderStrategies();
}

function renderStrategies() {
  const out = $('#strategyResult');
  const cards = state.tarjetas.filter(c => c.saldo > 0);
  const sumMin = cards.reduce((s, c) => s + Number(c.minimo), 0);
  const deuda = cards.reduce((s, c) => s + Number(c.saldo), 0);
  $('#budgetHint').textContent = cards.length ? `Deuda total: ${money(deuda)} · Suma de pagos mínimos: ${money(sumMin)}. Todo lo que pongas por encima de los mínimos acelera el pago.` : '';

  if (!cards.length) { out.innerHTML = '<p class="muted">Agrega al menos una tarjeta con saldo.</p>'; return; }
  const budget = state.presupuestoDeuda;
  if (!budget || budget < sumMin) {
    out.innerHTML = `<div class="warning">Ingresa un presupuesto mensual de al menos <strong>${money(sumMin)}</strong> (la suma de los pagos mínimos). Si no te alcanza para los mínimos, conviene hablar con el banco para refinanciar o consolidar la deuda.</div>`;
    return;
  }

  const snow = simulate(cards, budget, 'snowball');
  const aval = simulate(cards, budget, 'avalanche');
  const mins = simulate(cards, budget, 'minimum');

  const ahorroAval = snow.totalInterest - aval.totalInterest;
  const umbral = Math.max(deuda * 0.01, 1); // diferencia menor al 1% de la deuda = casi igual
  let reco;
  if (!snow.finished && !aval.finished) {
    reco = `<div class="warning">Con ${money(budget)} al mes los intereses crecen más rápido que tus pagos. Necesitas aumentar el presupuesto mensual.</div>`;
  } else if (ahorroAval > umbral) {
    reco = `<div class="recommendation"><strong>Recomendación: Avalancha.</strong> Te ahorra <strong>${money(ahorroAval)}</strong> en intereses frente a la bola de nieve${aval.months < snow.months ? ` y terminas ${snow.months - aval.months} mes(es) antes` : ''}. Si necesitas motivación para no abandonar, la bola de nieve sigue siendo una buena opción: lo importante es no dejar de pagar más del mínimo.</div>`;
  } else {
    reco = `<div class="recommendation"><strong>Recomendación: Bola de nieve.</strong> La diferencia en intereses con la avalancha es muy pequeña (${money(Math.abs(ahorroAval))}), así que conviene la bola de nieve: liquidas tarjetas completas más rápido y eso ayuda a mantener la disciplina.</div>`;
  }

  const best = ahorroAval > umbral ? 'avalanche' : 'snowball';
  const box = (key, title, r) => `
    <div class="strategy ${key === best ? 'best' : ''}">
      <h3>${title} ${key === best ? '<span class="tag">✓ RECOMENDADA</span>' : ''}</h3>
      <dl>
        <dt>Tiempo para quedar libre</dt><dd>${r.finished ? monthsToText(r.months) : '<span class="neg">Nunca</span>'}</dd>
        <dt>Terminas en</dt><dd>${r.finished ? payoffDate(r.months) : '—'}</dd>
        <dt>Intereses pagados</dt><dd>${r.finished ? money(r.totalInterest) : '—'}</dd>
        <dt>Total pagado</dt><dd>${r.finished ? money(r.totalPaid) : '—'}</dd>
      </dl>
      ${r.finished ? '' : '<p class="small neg">En alguna tarjeta el interés mensual supera el pago, así que la deuda no deja de crecer.</p>'}
    </div>`;

  const plan = best === 'avalanche' ? aval : snow;
  const planRows = plan.order.map((d, i) => `
    <tr><td>${i + 1}</td><td>${esc(d.nombre)}</td><td class="num">${Number(d.tasa).toFixed(2)}%</td><td class="num">${money(d.saldo)}</td>
    <td class="num"><strong>${money(d.firstPayment)}</strong></td>
    <td class="num">${d.paidOffMonth ? payoffDate(d.paidOffMonth) : '—'}</td></tr>`).join('');

  out.innerHTML = reco + `<div class="strategies">
      ${box('snowball', 'Bola de nieve', snow)}
      ${box('avalanche', 'Avalancha', aval)}
      ${box('minimum', 'Solo mínimos', mins)}
    </div>
    <h3 class="plan-title">Tu plan de pago este mes (${best === 'avalanche' ? 'avalancha' : 'bola de nieve'})</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Orden</th><th>Tarjeta</th><th class="num">Tasa</th><th class="num">Saldo</th><th class="num">Paga este mes</th><th class="num">Queda liquidada</th></tr></thead>
      <tbody>${planRows}</tbody>
    </table></div>
    <p class="muted small">Cálculo aproximado: interés mensual = tasa anual / 12, pagos mínimos fijos. Actualiza los saldos cada mes para recalcular. Tip: registra el pago como “Gasto fijo → Pago de tarjeta”.</p>`;
}

// ---------- Respaldo ----------
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `finanzas-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#importInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.movimientos)) throw new Error('Formato inválido');
    if (!confirm('Esto reemplazará tus datos actuales por los del respaldo. ¿Continuar?')) return;
    state = Object.assign(defaultState(), data);
    saveState(); init();
  } catch (err) { alert('No se pudo importar el archivo: ' + err.message); }
  e.target.value = '';
});

// ---------- Inicio ----------
function renderAll() {
  renderResumen();
  renderMovimientos();
  renderEvolucionTable();
  renderChart();
  renderTarjetas();
}
async function init() {
  await loadState();
  $('#currencyInput').value = state.moneda;
  setMonth(currentMonth);
}
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderChart, 150); });
init();
