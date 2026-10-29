// Reportes: gráficas (Chart.js), tabla y PDF (diálogo de impresión del navegador).
import { C, getDocs, query, where, orderBy, Timestamp } from './firebase.js';
import { $, esc, fmt, money, toast, dur } from './utils.js';
import { t, tp, locale, aplicar, setIdioma, idioma } from './i18n.js';

const PALETA = ['#2a6f97', '#e07a5f', '#81b29a', '#f2cc8f', '#6d597a', '#b56576', '#3d405b', '#e9c46a', '#457b9d', '#8ab17d'];
const INK = '#101828', GRID = '#e0e5ec';
const TIPOS = { gIngresos: 'bar', gHoras: 'line', gLugares: 'bar', gOcupacion: 'doughnut' };
// Titulos de los ejes (se piden al dibujar, para que respeten el idioma elegido)
const ejes = id => ({
  gIngresos: { x: t('r.ejeDia'), y: t('r.ejePesos') },
  gHoras: { x: t('r.ejeHora'), y: t('r.ejeEntradas') },
  gLugares: { x: t('r.ejeLugar'), y: t('r.ejeVeces') },
  gOcupacion: { x: '', y: t('r.ejeLugares') }
}[id]);
const FORMATO = { gIngresos: money };           // cómo se muestran los valores
const graficas = {};
let datos = { regs: [], lugares: [] }, ultimo = null;

const diaKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inputADate = v => new Date(v + 'T00:00:00');

// Plugin propio: valor sobre cada barra/punto y valor + % en pasteles.
// Si no cabe en horizontal lo gira; si ni así cabe, lo omite (queda el tooltip).
const etiquetasValor = {
  id: 'etiquetasValor',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx, ds = chart.data.datasets[0], meta = chart.getDatasetMeta(0);
    const f = FORMATO[chart.canvas.id] || (v => v);
    const circular = chart.config.type === 'pie' || chart.config.type === 'doughnut';
    const total = ds.data.reduce((a, b) => a + b, 0);
    const slot = circular ? 0 : chart.chartArea.width / meta.data.length;
    ctx.save();
    ctx.font = '600 12px Barlow, system-ui, sans-serif'; ctx.textAlign = 'center';
    meta.data.forEach((el, i) => {
      const v = ds.data[i];
      if (!v) return;
      if (circular) {
        if (v / total < 0.06) return;                       // rebanadas chicas: solo leyenda y tooltip
        const p = el.tooltipPosition(), t = `${f(v)} (${Math.round(v / total * 100)}%)`;
        ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.fillStyle = '#fff';
        ctx.strokeText(t, p.x, p.y); ctx.fillText(t, p.x, p.y);
      } else {
        const t = String(f(v)), w = ctx.measureText(t).width + 4;
        ctx.fillStyle = INK;
        if (w <= slot) {
          ctx.textBaseline = 'bottom'; ctx.fillText(t, el.x, el.y - 6);
        } else if (slot >= 14) {
          ctx.save(); ctx.translate(el.x, el.y - 6); ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, 0, 0); ctx.restore();
        }
      }
    });
    ctx.restore();
  }
};

// ---------- Carga de datos ----------
async function generar() {
  const desde = inputADate($('#desde').value);
  const hasta = new Date($('#hasta').value + 'T23:59:59.999');
  if (isNaN(desde) || isNaN(hasta) || hasta < desde) return toast(t('r.errRango'));
  $('#btnGenerar').disabled = true;
  try {
    const [rs, ls] = await Promise.all([
      getDocs(query(C.r,
        where('hora_entrada', '>=', Timestamp.fromDate(desde)),
        where('hora_entrada', '<=', Timestamp.fromDate(hasta)),
        orderBy('hora_entrada', 'desc'))),
      getDocs(C.l)
    ]);
    datos.regs = rs.docs.map(d => d.data());
    datos.lugares = ls.docs.map(d => d.data()).sort((a, b) => a.numero - b.numero);
    datos.desde = desde; datos.hasta = hasta;
    render();
  } catch (e) {
    toast(t('r.errCarga', { e: e.code || e.message }));
  } finally {
    $('#btnGenerar').disabled = false;
  }
}

// ---------- Cálculos ----------
const maxIdx = arr => arr.reduce((m, v, i) => v > arr[m] ? i : m, 0);

function calcular() {
  const { regs, lugares, desde, hasta } = datos;
  const cerrados = regs.filter(r => r.hora_salida);
  const total = cerrados.reduce((s, r) => s + (r.monto_total || 0), 0);
  const tiempoMs = cerrados.length
    ? cerrados.reduce((s, r) => s + (r.hora_salida.toMillis() - r.hora_entrada.toMillis()), 0) / cerrados.length : 0;

  // Ingresos por día (fecha de entrada), con días sin movimiento en cero
  const porDia = new Map();
  for (let d = new Date(desde); d <= hasta; d.setDate(d.getDate() + 1)) porDia.set(diaKey(d), 0);
  cerrados.forEach(r => {
    const k = diaKey(r.hora_entrada.toDate());
    porDia.set(k, (porDia.get(k) || 0) + (r.monto_total || 0));
  });
  const etDia = k => inputADate(k).toLocaleDateString(locale(), { day: '2-digit', month: 'short' });
  const dLab = [...porDia.keys()].map(etDia), dVal = [...porDia.values()];

  // Entradas por hora
  const hVal = Array(24).fill(0);
  regs.forEach(r => hVal[r.hora_entrada.toDate().getHours()]++);
  const hLab = hVal.map((_, h) => String(h).padStart(2, '0') + ':00');

  // Uso por lugar
  const nums = lugares.length ? lugares.map(l => String(l.numero)) : Array.from({ length: 20 }, (_, i) => String(i + 1));
  const uso = Object.fromEntries(nums.map(n => [n, 0]));
  regs.forEach(r => { uso[r.id_lugar] = (uso[r.id_lugar] || 0) + 1; });
  const lLab = Object.keys(uso).map(n => t('r.lugarN', { n })), lVal = Object.values(uso);

  // Ocupación actual
  const ocu = lugares.filter(l => l.estado === 'ocupado').length, tot = lugares.length;

  const iD = maxIdx(dVal), iH = maxIdx(hVal), iL = maxIdx(lVal);
  return {
    kpi: { total, veh: regs.length, prom: cerrados.length ? total / cerrados.length : 0, tiempoMs },
    g: {
      gIngresos: {
        labels: dLab, valores: dVal, etiqueta: t('r.sIngresos'),
        nota: total > 0 ? t('r.nIng', { dia: dLab[iD], monto: money(dVal[iD]), total: money(total) }) : t('r.nIngNo')
      },
      gHoras: {
        labels: hLab, valores: hVal, etiqueta: t('r.sEntradas'),
        nota: regs.length ? tp('r.nHora', hVal[iH], { hora: hLab[iH] }) : t('r.nHoraNo')
      },
      gLugares: {
        labels: lLab, valores: lVal, etiqueta: t('r.sUso'),
        nota: regs.length ? tp('r.nLug', lVal[iL], { lugar: nums[iL], sin: lVal.filter(v => !v).length, tot: lVal.length }) : t('r.nLugNo')
      },
      gOcupacion: {
        labels: [t('st.disp'), t('st.ocu')], valores: [tot - ocu, ocu], etiqueta: t('r.sLugares'),
        colores: ['#22c55e', '#ef4444'],
        nota: tot ? t('r.nOcu', { o: ocu, t: tot, p: Math.round(ocu / tot * 100) }) : ''
      }
    }
  };
}

// ---------- Gráficas ----------
function dibujar(id, tipo, d) {
  graficas[id]?.destroy();
  const circular = tipo === 'pie' || tipo === 'doughnut';
  let labels = d.labels, valores = d.valores, colores = d.colores;
  if (circular && id !== 'gOcupacion') {            // sin ceros; si son muchos, top 7 + "Otros"
    let pares = valores.map((v, i) => [labels[i], v]).filter(x => x[1] > 0);
    if (pares.length > 8) {
      pares.sort((x, y) => y[1] - x[1]);
      const resto = pares.slice(7);
      pares = pares.slice(0, 7).concat([[t('r.otros', { n: resto.length }), resto.reduce((t, x) => t + x[1], 0)]]);
    }
    labels = pares.map(x => x[0]); valores = pares.map(x => x[1]);
  }
  const fondo = colores || (circular ? labels.map((_, i) => PALETA[i % PALETA.length]) : PALETA[0]);
  const f = FORMATO[id] || (v => v);

  graficas[id] = new Chart($('#' + id), {
    type: tipo,
    plugins: [etiquetasValor],
    data: {
      labels,
      datasets: [{
        label: d.etiqueta, data: valores,
        backgroundColor: fondo,
        borderColor: circular ? '#fff' : (colores ? fondo : PALETA[0]),
        borderRadius: tipo === 'bar' ? 6 : 0, tension: .3, pointRadius: 3, fill: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: (!circular && FORMATO[id] && labels.length > 12) ? 56 : 24 } },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: INK, font: { size: 13 }, usePointStyle: !circular } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${f(c.parsed.y ?? c.parsed)}` } }
      },
      scales: circular ? {} : {
        x: {
          title: { display: !!ejes(id).x, text: ejes(id).x, color: INK, font: { weight: '600' } },
          ticks: {
            color: INK,
            callback(v) { const txt = this.getLabelForValue(v); return id === 'gLugares' ? txt.replace(/^\D+/, '') : txt; }
          },
          grid: { display: false }
        },
        y: {
          beginAtZero: true, grace: '10%',
          title: { display: true, text: ejes(id).y, color: INK, font: { weight: '600' } },
          ticks: { color: INK, precision: 0, callback: v => f(v) },
          grid: { color: GRID }
        }
      }
    }
  });
}

// ---------- Pantalla ----------
function render() {
  ultimo = calcular();
  const { kpi, g } = ultimo;
  $('#kCobrado').textContent = money(kpi.total);
  $('#kVeh').textContent = kpi.veh;
  $('#kProm').textContent = money(kpi.prom);
  $('#kTiempo').textContent = kpi.tiempoMs ? dur(kpi.tiempoMs) : '—';
  $('#rango').textContent = t('r.rango', {
    a: datos.desde.toLocaleDateString(locale(), { dateStyle: 'long' }),
    b: datos.hasta.toLocaleDateString(locale(), { dateStyle: 'long' }),
    g: new Date().toLocaleString(locale())
  });

  for (const id of Object.keys(g)) {
    dibujar(id, $(`select[data-g="${id}"]`).value, g[id]);
    $('#n-' + id).textContent = g[id].nota;
  }

  pagina = 1;
  tabla();
}

// ---------- Tabla paginada ----------
let pagina = 1, porPag = 50;
const fila = (r, i) => `<tr><td>${i + 1}</td><td>${esc(r.id_lugar)}</td><td><span class="pl">${esc(r.id_vehiculo)}</span></td><td>${fmt(r.hora_entrada)}</td><td>${r.hora_salida ? fmt(r.hora_salida) : t('h.enCurso')}</td><td>${r.hora_salida ? money(r.monto_total) : '—'}</td></tr>`;

function tabla(todas = false) {
  const n = datos.regs.length, paginas = Math.max(1, Math.ceil(n / porPag));
  pagina = Math.min(Math.max(1, pagina), paginas);
  const ini = todas ? 0 : (pagina - 1) * porPag, fin = todas ? n : Math.min(n, ini + porPag);
  $('#tb').innerHTML = n
    ? datos.regs.slice(ini, fin).map((r, i) => fila(r, ini + i)).join('')
    : `<tr><td colspan="6" class="empty">${t('r.sinMov')}</td></tr>`;
  $('#nota').textContent = n ? t('r.mostrando', { a: ini + 1, b: fin, n }) : '';
  pager(paginas);
}

function pager(paginas) {
  const nums = new Set([1, paginas, pagina - 1, pagina, pagina + 1]);
  const lista = [...nums].filter(p => p >= 1 && p <= paginas).sort((a, b) => a - b);
  let html = `<button data-p="${pagina - 1}" ${pagina === 1 ? 'disabled' : ''}>${t('r.ant')}</button>`;
  lista.forEach((p, i) => {
    if (i && p - lista[i - 1] > 1) html += '<span class="pp">…</span>';
    html += `<button data-p="${p}" class="${p === pagina ? 'act' : ''}">${p}</button>`;
  });
  html += `<button data-p="${pagina + 1}" ${pagina === paginas ? 'disabled' : ''}>${t('r.sig')}</button>`;
  $('#pag').innerHTML = paginas > 1 ? html : '';
}

// ---------- Eventos ----------
const hoy = new Date(), hace7 = new Date(); hace7.setDate(hoy.getDate() - 6);
$('#hasta').value = diaKey(hoy);
$('#desde').value = diaKey(hace7);
document.querySelectorAll('select[data-g]').forEach(s => {
  s.value = TIPOS[s.dataset.g];
  s.onchange = () => ultimo && dibujar(s.dataset.g, s.value, ultimo.g[s.dataset.g]);
});
$('#btnGenerar').onclick = generar;
$('#btnPdf').onclick = () => window.print();
$('#pag').onclick = e => {
  const b = e.target.closest('button[data-p]');
  if (b && !b.disabled) { pagina = Number(b.dataset.p); tabla(); $('#tb').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
};
$('#porPag').onchange = e => { porPag = Number(e.target.value); pagina = 1; tabla(); };
// Ajusta las gráficas al ancho de la hoja antes de imprimir
// Al imprimir: gráficas ajustadas y la tabla completa (no solo la página visible)
window.addEventListener('beforeprint', () => { Object.values(graficas).forEach(c => c.resize()); tabla(true); });
window.addEventListener('afterprint', () => tabla());
// ---------- Idioma ----------
aplicar();
$('#selIdioma').value = idioma();
$('#selIdioma').onchange = e => setIdioma(e.target.value);
document.addEventListener('idioma', () => {
  $('#selIdioma').value = idioma();
  if (ultimo) render();                     // vuelve a pintar graficas, notas y tabla en el idioma nuevo
  else tabla();
});

generar();