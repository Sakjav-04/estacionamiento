// Mapa del estacionamiento (RF-01, RF-02, RF-08) y búsqueda por placa.
import { state, W, H, COLORES } from './state.js';
import { $ } from './utils.js';
import { t } from './i18n.js';
import { panel } from './panel.js';

const cv = $('#cv'), ctx = cv.getContext('2d');

function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function draw(ahora) {   // `ahora` = tiempo de la animacion (antes se llamaba t y chocaba con la traduccion t())
  const { lugares, clientes, sel, busca } = state;
  ctx.clearRect(0, 0, 960, 460);
  ctx.fillStyle = '#1b2430'; ctx.fillRect(0, 0, 960, 460);
  ctx.strokeStyle = '#f5c518'; ctx.lineWidth = 3; ctx.setLineDash([22, 16]);
  ctx.beginPath(); ctx.moveTo(20, 230); ctx.lineTo(940, 230); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#3b4a63'; ctx.font = '600 15px Barlow'; ctx.textAlign = 'center';
  ctx.fillText(t('mapa.entrada') + '  ›››', 90, 222); ctx.fillText('‹‹‹  ' + t('mapa.salida'), 870, 252);

  for (const l of Object.values(lugares)) {
    const { pos_x: x, pos_y: y } = l, occ = l.estado === 'ocupado', top = y < 200;
    ctx.fillStyle = occ ? '#7f1d1d' : '#14532d'; rr(x, y, W, H, 8); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = occ ? '#ef4444' : '#22c55e'; ctx.stroke();

    if (occ) {
      const cl = clientes[l.id_vehiculo_actual], cx = x + W / 2, cy = y + H / 2 + (top ? 6 : -6);
      ctx.fillStyle = COLORES[cl?.color] || '#94a3b8'; rr(cx - 22, cy - 42, 44, 84, 10); ctx.fill();
      ctx.fillStyle = '#0f172acc'; rr(cx - 17, cy - 26, 34, 16, 4); ctx.fill(); rr(cx - 17, cy + 12, 34, 12, 4); ctx.fill();
      ctx.fillStyle = '#fff'; rr(x + 8, top ? y + H - 24 : y + 6, W - 16, 17, 3); ctx.fill();
      ctx.fillStyle = '#101828'; ctx.font = '700 12px Barlow';
      ctx.fillText(l.id_vehiculo_actual.slice(0, 8), x + W / 2, (top ? y + H - 24 : y + 6) + 13);
    }

    ctx.fillStyle = '#fff'; ctx.font = '700 26px "Barlow Condensed"';
    ctx.fillText(l.numero, x + W / 2, top ? y + 28 : y + H - 10);

    if (String(l.numero) === String(sel)) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; rr(x - 5, y - 5, W + 10, H + 10, 11); ctx.stroke();
    }
    if (busca && occ && l.id_vehiculo_actual.includes(busca)) {
      const a = .55 + .45 * Math.sin(ahora / 180);
      ctx.strokeStyle = `rgba(245,197,24,${a})`; ctx.lineWidth = 6; rr(x - 6, y - 6, W + 12, H + 12, 12); ctx.stroke();
    }
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// RF-03: detectar clic dentro del lienzo
cv.onclick = e => {
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) * 960 / r.width, y = (e.clientY - r.top) * 460 / r.height;
  const l = Object.values(state.lugares).find(l => x >= l.pos_x && x <= l.pos_x + W && y >= l.pos_y && y <= l.pos_y + H);
  if (l) { state.sel = l.numero; state.lastKey = ''; panel(); }
};

export function buscar() {
  const h = $('#hint');
  if (!state.busca) { h.textContent = ''; return; }
  const m = Object.values(state.lugares).filter(l => l.estado === 'ocupado' && l.id_vehiculo_actual.includes(state.busca));
  h.innerHTML = m.length ? t('hint.lugar') + ' <b>' + m.map(l => l.numero).join(', ') + '</b>' : t('hint.no');
}
