// Panel lateral (RF-03, RF-04, RF-05)
import { state, COLORES, PERDIDA } from './state.js';
import { $, esc, fmt, money, total, dur, cargoPerdido, toast } from './utils.js';
import { t, nombreColor } from './i18n.js';
import { entrada, salida, perdido, cancelar } from './operaciones.js';
import {
  abrirCabina, getInspeccion, limpiarInspeccion, textoDanos, miniaturasHtml, cargarInspeccion, mostrarInspeccion
} from './cabina.js';
import { abrirTicket } from './ticket.js';

let insDe = null;   // cajon libre en el que se empezo la inspeccion pendiente

// Cuadro de la inspeccion dentro del formulario de entrada
function pintarInspeccion() {
  const box = $('#insBox'), btn = $('#btnCam');
  if (!box || !btn) return;
  const ins = getInspeccion();
  box.innerHTML = ins
    ? miniaturasHtml(ins.fotos) + `<p class="ins-res"><b>${t('tk.danos')}:</b> ${esc(textoDanos(ins.resumen))}</p>`
    : `<div class="empty ins-vacia">${t('ins.vacia')}</div>`;
  btn.textContent = ins ? t('ins.btnEditar') : t('ins.btnIniciar');
}

export function panel() {
  const l = state.lugares[String(state.sel)];
  if (!l) return;
  const key = l.estado + l.id_vehiculo_actual + (state.clientes[l.id_vehiculo_actual] ? 1 : 0) + (l.boleto_perdido ? 'P' : '');
  if (key === state.lastKey) return;
  state.lastKey = key;

  const P = $('#panel'), occ = l.estado === 'ocupado';

  // La inspeccion pendiente pertenece al cajon libre donde se empezo: si cambias de cajon
  // (o ese cajon ya se ocupo) se descarta. Cambiar de idioma no la borra.
  if (occ || insDe !== l.numero) { limpiarInspeccion(); insDe = occ ? null : l.numero; }

  const head = `<h2>${t('p.lugar')} ${l.numero} <span class="badge" style="background:${occ ? 'var(--bad)' : 'var(--ok)'}">${occ ? t('p.ocupado') : t('p.disponible')}</span></h2>`;

  if (!occ) {
    P.innerHTML = head + `<form id="f">
    <label>${t('ins.titulo')}</label>
    <div id="insBox"></div>
    <button type="button" id="btnCam" class="secondary"></button>
    <label>${t('p.placa')}</label><input name="placa" required maxlength="10" placeholder="ABC123" style="text-transform:uppercase">
    <div class="row"><div><label>${t('p.modelo')}</label><input name="modelo" required placeholder="Nissan Versa"></div>
    <div><label>${t('p.color')}</label><select name="color">${Object.keys(COLORES).map(c => `<option value="${c}">${nombreColor(c)}</option>`).join('')}</select></div></div>
    <label>${t('p.nombre')}</label><input name="nombre" required><label>${t('p.tel')}</label><input name="tel" type="tel" required placeholder="55 1234 5678">
    <button>${t('p.registrar')}</button></form>`;
    pintarInspeccion();
    // "abrir camara" por voz pulsa este mismo boton
    $('#btnCam').onclick = () => abrirCabina(pintarInspeccion);
    $('#f').onsubmit = e => { e.preventDefault(); entrada(l, new FormData(e.target), e.submitter); };
  } else {
    const c = state.clientes[l.id_vehiculo_actual] || {};
    const pr = cargoPerdido(l);
    const foto = c.foto
      ? `<img class="foto-auto" src="${esc(c.foto)}" alt="${t('p.foto')}">`
      : `<div class="foto-vacia">${t('p.sinFoto')}</div>`;
    const danos = c.danos
      ? `<p class="ins-res"><b>${t('tk.danos')}:</b> ${esc(textoDanos(c.danos))}</p>
         <button type="button" class="outline secondary" id="verIns">${t('ins.ver')}</button>`
      : '';
    P.innerHTML = head + foto + danos + `<dl><dt>${t('p.placa')}</dt><dd><span class="pl">${esc(c.placa || l.id_vehiculo_actual)}</span></dd><dt>${t('p.vehiculo')}</dt><dd>${esc(c.modelo)} · ${esc(c.color ? nombreColor(c.color) : c.color)}</dd>
    <dt>${t('p.cliente')}</dt><dd>${esc(c.nombre_cliente)}</dd><dt>${t('p.tel')}</dt><dd>${esc(c.telefono)}</dd><dt>${t('p.entrada')}</dt><dd>${fmt(l.hora_entrada)}</dd><dt>${t('p.tiempo')}</dt><dd id="tT">—</dd></dl>
    <div class="tot"><span>${t('p.tarifaAcum')}</span><span class="num" id="tM">—</span></div>
    ${pr ? `<small class="nota-perdido">${t('p.incluyePerdido', { monto: money(pr) })}</small>` : ''}
    <button class="secondary" id="prev">${t('p.prev')}</button>
    <button class="outline" id="perd">${pr ? t('p.perdidoOff') : t('p.perdidoOn', { monto: money(PERDIDA) })}</button>
    <button class="bad" id="lib">${t('p.liberar')}</button>
    <button class="outline secondary" id="cnc">${t('p.cancelar')}</button>`;
    if ($('#verIns')) {
      $('#verIns').onclick = async () => {
        const b = $('#verIns');
        b.disabled = true;
        const d = await cargarInspeccion(l.id_registro_actual);
        b.disabled = false;
        if (d) mostrarInspeccion(d); else toast(t('ins.noCargo'));
      };
    }
    $('#prev').onclick = () => abrirTicket({ l: state.lugares[String(l.numero)] || l, c, salida: new Date(), final: false });
    $('#perd').onclick = () => perdido(l, $('#perd'));
    $('#lib').onclick = () => salida(l, c, $('#lib'));
    $('#cnc').onclick = () => cancelar(l, $('#cnc'));
    tick();
  }
}

export function tick() {
  const l = state.lugares[String(state.sel)];
  if (!l || l.estado !== 'ocupado' || !l.hora_entrada || !$('#tT')) return;
  const a = l.hora_entrada.toMillis(), n = Date.now();
  $('#tT').textContent = dur(n - a);
  $('#tM').textContent = money(total(l, a, n));
}