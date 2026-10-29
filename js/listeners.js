// Suscripciones en tiempo real a Firestore (RF-06) y resumen (RF-09).
import { db, C, doc, onSnapshot, writeBatch, query, orderBy, limit } from './firebase.js';
import { state } from './state.js';
import { $, esc, fmt, money, toast, norm } from './utils.js';
import { panel } from './panel.js';
import { buscar } from './canvas.js';
import { t } from './i18n.js';

let enLinea = null;   // ultimo estado de conexion (null = todavia conectando)
export const pintarSync = () => {
  $('#dot').classList.toggle('on', !!enLinea);
  $('#syncTxt').textContent = enLinea === null ? t('sync.conectando') : enLinea ? t('sync.ok') : t('sync.off');
};
const sync = ok => { enLinea = ok; pintarSync(); };

function resumen() {
  const a = Object.values(state.lugares);
  const o = a.filter(l => l.estado === 'ocupado').length;
  $('#sDisp').textContent = (a.length - o) + '/' + a.length;
  $('#sOcu').textContent = o;
}

// Primera vez: crea los 20 lugares con su posición en el canvas
function sembrar() {
  const b = writeBatch(db);
  for (let n = 1; n <= 20; n++) {
    const i = n - 1, col = i % 10, row = i < 10 ? 0 : 1;
    b.set(doc(C.l, String(n)), {
      id_lugar: String(n), numero: n, estado: 'disponible',
      id_vehiculo_actual: null, id_registro_actual: null, hora_entrada: null,
      pos_x: 30 + col * 92, pos_y: row ? 300 : 30
    });
  }
  b.commit().then(() => toast(t('fs.sembrados')));
}

onSnapshot(C.l, s => {
  if (s.empty && !state.seeded) { state.seeded = true; sembrar(); return; }
  state.lugares = {};
  s.forEach(d => state.lugares[d.id] = d.data());
  sync(true); resumen(); panel();
}, e => { sync(false); toast(t('fs.error', { code: e.code })); });

onSnapshot(C.c, s => {
  state.clientes = {};
  s.forEach(d => state.clientes[d.id] = d.data());
  panel(); buscar();
});

// Dibuja la tabla del historial aplicando el filtro (placa o lugar)
export function filtrarHistorial(lista) {
  const q = state.filtro.trim(), qp = norm(q);
  return !q ? lista : lista.filter(r =>
    (qp && norm(r.id_vehiculo).includes(qp)) || String(r.id_lugar) === q);
}

export function pintarHistorial() {
  const q = state.filtro.trim();
  const rows = filtrarHistorial(state.hist);
  $('#hb').innerHTML = rows.length
    ? rows.map(r => `<tr><td>${esc(r.id_lugar)}</td><td><span class="pl">${esc(r.id_vehiculo)}</span></td><td>${fmt(r.hora_entrada)}</td><td>${r.hora_salida ? fmt(r.hora_salida) : `<b style="color:#16a34a">${t('h.enCurso')}</b>`}</td><td>${r.hora_salida ? money(r.monto_total) : '—'}${r.boleto_perdido ? ` <small>(${t('h.perdido')})</small>` : ''}</td></tr>`).join('')
    : `<tr><td colspan="5" class="empty">${q ? t('h.sinRes') : t('h.vacio')}</td></tr>`;
}

onSnapshot(query(C.r, orderBy('hora_entrada', 'desc'), limit(40)), s => {
  const rows = [];
  let hoy = 0;
  const h0 = new Date().setHours(0, 0, 0, 0);
  s.forEach(d => {
    const r = d.data();
    rows.push(r);
    if (r.hora_salida && r.hora_salida.toMillis() >= h0) hoy += r.monto_total || 0;
  });
  $('#sIng').textContent = money(hoy);
  state.hist = rows;
  pintarHistorial();
});
