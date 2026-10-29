// Ticket de salida: vista en pantalla, vista previa, imprimir y PDF (jsPDF).
import { $, esc, money, dur, horas, calc, tarifaHora, cargoPerdido, narrar } from './utils.js';
import { t as tr, locale } from './i18n.js';
import { crearQR, qrSvg, qrEnPdf } from './qr.js';
import { cargarInspeccion, miniaturasHtml, textoDanos, nombreVista, nombreTipo, zonaTexto } from './cabina.js';

let ultimo = null;   // datos del ultimo ticket mostrado (los usa el PDF)

// Fecha en el idioma elegido. Se cambian los espacios especiales (a veces trae el navegador)
// por espacios normales, porque el PDF y el QR no los saben dibujar.
const fechaHora = d => d.toLocaleString(locale(), {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).replace(/[\u00A0\u2000-\u206F]/g, ' ');

// Filas de datos que se muestran igual en pantalla y en el PDF
const filas = t => [
  [tr('tk.folio'), String(t.folio || '').slice(0, 8).toUpperCase() || '-'],
  [tr('tk.lugar'), String(t.lugar)],
  [tr('tk.placa'), t.placa],
  [tr('tk.vehiculo'), `${t.modelo || '-'} · ${t.color ? tr('color.' + t.color) : '-'}`],
  [tr('tk.cliente'), t.cliente || '-'],
  [tr('tk.tel'), t.tel || '-'],
  [tr('tk.entrada'), fechaHora(t.entrada)],
  [t.final ? tr('tk.salida') : tr('tk.hasta'), fechaHora(t.salida)],
  [tr('tk.tiempo'), t.tiempo],
  [tr('tk.horas'), `${t.horas} h x ${money(t.tarifa)}`]
];

// Texto que guarda el QR: el mismo contenido del ticket (cualquier celular lo muestra al escanear).
// Si no quieres algun dato en el QR (ej. el telefono), agrega despues de filas(t):  .filter(([k]) => k !== tr('tk.tel'))
const textoQR = t => [
  tr('tk.qrTitulo'),
  ...filas(t).map(([k, v]) => `${k}: ${v}`),
  `${tr('tk.subtotal')}: ${money(t.sub)}`,
  ...(t.extra ? [`${tr('tk.perdido')}: ${money(t.extra)}`] : []),
  `${tr('tk.total')}: ${money(t.total)}`
].join('\n');

// final = true  -> ticket de salida (se puede imprimir y bajar en PDF)
// final = false -> vista previa (solo se ve, el cajon NO se libera)
export function abrirTicket({ l, c, salida, final }) {
  const entrada = l.hora_entrada.toDate();
  const a = entrada.getTime(), b = salida.getTime();
  const sub = calc(a, b), extra = cargoPerdido(l);

  ultimo = {
    folio: l.id_registro_actual, lugar: l.numero,
    placa: c.placa || l.id_vehiculo_actual || '',
    modelo: c.modelo, color: c.color, cliente: c.nombre_cliente, tel: c.telefono,
    entrada, salida, tiempo: dur(b - a), horas: horas(a, b), tarifa: tarifaHora(),
    sub, extra, total: sub + extra, foto: c.foto || null, danos: c.danos || null, final
  };
  const t = ultimo;
  t.qr = final ? crearQR(textoQR(t)) : null;   // el ticket de vista previa no lleva QR

  $('#tkTitulo').textContent = final ? tr('tk.tituloFinal') : tr('tk.tituloPrev');
  $('#tkMsg').textContent = '';
  $('#ticket').innerHTML = `
    <div class="tk">
      <img class="tk-logo" src="img/logo.svg" alt="Patio Central">
      <h3>Patio Central</h3>
      <small>${tr('app.sub')}</small>
      <p class="tk-tipo">${final ? tr('tk.tipoFinal') : tr('tk.tipoPrev')}</p>
      <div id="tkFotos">${t.foto ? `<img class="tk-foto" src="${esc(t.foto)}" alt="${tr('p.foto')}">` : ''}</div>
      ${t.danos ? `<p class="tk-danos"><b>${tr('tk.danos')}:</b> ${esc(textoDanos(t.danos))}</p>` : ''}
      <dl>${filas(t).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="tk-linea"><span>${tr('tk.subtotal')}</span><span>${money(t.sub)}</span></div>
      ${t.extra ? `<div class="tk-linea"><span>${tr('tk.perdido')}</span><span>${money(t.extra)}</span></div>` : ''}
      <div class="tk-total"><span>${tr('tk.total')}</span><span>${money(t.total)}</span></div>
      ${t.qr ? `<div class="tk-qr">${qrSvg(t.qr)}</div><small>${tr('tk.escanea')}</small>` : ''}
      <p class="tk-gracias">${tr('tk.gracias')}</p>
    </div>`;

  // Las 4 fotos de la inspeccion se descargan aparte; al llegar reemplazan a la foto del frente
  t.carga = cargarInspeccion(t.folio).then(d => {
    if (d && d.fotos && d.fotos.length && ultimo === t && $('#tkFotos')) $('#tkFotos').innerHTML = miniaturasHtml(d.fotos);
    return d;
  });

  // Imprimir y PDF solo en el ticket final
  $('#tkPdf').hidden = !final;
  $('#tkImprimir').hidden = !final;

  const dlg = $('#dlg');
  if (!dlg.open) dlg.showModal();
}

// ---------- Utilidades para el PDF ----------
// jsPDF no lee SVG, asi que el logo se convierte a PNG con un canvas
const svgAPng = url => new Promise(res => {
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    cv.getContext('2d').drawImage(img, 0, 0, 256, 256);
    res(cv.toDataURL('image/png'));
  };
  img.onerror = () => res(null);
  img.src = url;
});

const dimensiones = src => new Promise(res => {
  const img = new Image();
  img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
  img.onerror = () => res(null);
  img.src = src;
});

async function descargarPdf() {
  const t = ultimo;
  if (!t) return;
  if (!window.jspdf) { $('#tkMsg').textContent = tr('tk.sinPdf'); return; }
  const { jsPDF } = window.jspdf;

  const ANCHO = 80, M = 6, ANCHO_FOTO = 50, TAM_QR = 44, SEP = 3, COL = (ANCHO - 2 * M - SEP) / 2;
  const logo = await svgAPng('img/logo.svg');

  // Fotos de la inspeccion (2 x 2). Si no hay (registros viejos) se usa la foto unica de siempre.
  const ins = await t.carga;
  const fotos = ins && ins.fotos && ins.fotos.length ? ins.fotos : null;
  const dims = fotos ? await Promise.all(fotos.map(f => dimensiones(f.img))) : [];
  const filasFotos = [];
  for (let i = 0; fotos && i < fotos.length; i += 2) {
    const alto = Math.max(...[dims[i], dims[i + 1]].filter(Boolean).map(d => COL * d.h / d.w), 0);
    filasFotos.push({ fotos: fotos.slice(i, i + 2), dims: dims.slice(i, i + 2), alto });
  }
  const altoFotos = filasFotos.reduce((s, f) => s + f.alto + 6, 0);
  const dim = !fotos && t.foto ? await dimensiones(t.foto) : null;
  const altoFoto = dim ? ANCHO_FOTO * dim.h / dim.w : 0;

  // Primero se miden las filas para saber cuanto mide la hoja
  const medidor = new jsPDF({ unit: 'mm', format: [ANCHO, 200] });
  medidor.setFontSize(8.5);
  const datos = filas(t).map(([k, v]) => [k, medidor.splitTextToSize(String(v), 42)]);
  const lineas = datos.reduce((s, d) => s + d[1].length, 0);
  // Lista de danos: "Frente 1. Rayon · lado derecho · abajo"
  medidor.setFontSize(7.5);
  const listaDanos = !fotos ? [] : fotos.flatMap(f => (f.danos || []).map(d =>
    medidor.splitTextToSize(`${nombreVista(f.vista)} ${d.n}. ${nombreTipo(d.tipo)} · ${zonaTexto(d.zona)}`, ANCHO - 2 * M)));
  const resumen = ins ? ins.resumen : t.danos;
  const conDanos = !!(fotos || t.danos);
  medidor.setFont('helvetica', 'bold'); medidor.setFontSize(8.5);
  const cabDanos = !conDanos ? [] : medidor.splitTextToSize(resumen && Object.keys(resumen).length
    ? `${tr('tk.danos')}: ${textoDanos(resumen)}` : tr('tk.sinDanos'), ANCHO - 2 * M);
  const lineasDanos = listaDanos.reduce((s, l) => s + l.length, 0);
  const altoDanos = conDanos ? cabDanos.length * 4.2 + lineasDanos * 3.6 + 8 : 0;
  const alto = 52 + altoFotos + (dim ? altoFoto + 5 : 0) + altoDanos + lineas * 4.4 + 34 + (t.qr ? TAM_QR + 19 : 0);

  const doc = new jsPDF({ unit: 'mm', format: [ANCHO, alto] });
  let y = 6;
  if (logo) doc.addImage(logo, 'PNG', (ANCHO - 18) / 2, y, 18, 18);
  y += 23;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('Patio Central', ANCHO / 2, y, { align: 'center' }); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(tr('app.sub'), ANCHO / 2, y, { align: 'center' }); y += 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(tr('tk.tipoFinal'), ANCHO / 2, y, { align: 'center' }); y += 4;

  const raya = () => {
    doc.setLineDashPattern([1, 1], 0);
    doc.line(M, y, ANCHO - M, y);
    doc.setLineDashPattern([], 0);
    y += 4.5;
  };
  raya();

  if (filasFotos.length) {
    filasFotos.forEach(f => {
      f.fotos.forEach((foto, j) => {
        const d = f.dims[j], x = M + j * (COL + SEP);
        if (d) doc.addImage(foto.img, 'JPEG', x, y, COL, COL * d.h / d.w);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
        doc.text(`${nombreVista(foto.vista)}${foto.danos && foto.danos.length ? ` (${foto.danos.length})` : ''}`, x, y + f.alto + 3);
      });
      y += f.alto + 6;
    });
  } else if (dim) {
    doc.addImage(t.foto, 'JPEG', (ANCHO - ANCHO_FOTO) / 2, y, ANCHO_FOTO, altoFoto);
    y += altoFoto + 5;
  }

  // Danos registrados al entrar
  if (conDanos) {
    y += 2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    cabDanos.forEach(linea => { doc.text(linea, M, y); y += 4.2; });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    listaDanos.forEach(ls => ls.forEach(linea => { doc.text(linea, M, y); y += 3.6; }));
    y += 1.5; raya();
  }

  doc.setFontSize(8.5);
  datos.forEach(([k, ls]) => {
    doc.setFont('helvetica', 'normal'); doc.text(k, M, y);
    doc.setFont('helvetica', 'bold');
    ls.forEach((linea, i) => doc.text(linea, ANCHO - M, y + i * 4.4, { align: 'right' }));
    y += ls.length * 4.4;
  });
  y += 1; raya();

  const linea = (k, v, grande) => {
    doc.setFont('helvetica', grande ? 'bold' : 'normal');
    doc.setFontSize(grande ? 12 : 8.5);
    doc.text(k, M, y); doc.text(v, ANCHO - M, y, { align: 'right' });
    y += grande ? 7 : 4.8;
  };
  linea(tr('tk.subtotal'), money(t.sub));
  if (t.extra) linea(tr('tk.perdido'), money(t.extra));
  linea(tr('tk.total'), money(t.total), true);

  // Codigo QR con el contenido del ticket (queda blanco alrededor para que se pueda leer)
  if (t.qr) {
    y += 3; raya(); y += 2;
    qrEnPdf(doc, t.qr, (ANCHO - TAM_QR) / 2, y, TAM_QR);
    y += TAM_QR + 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(tr('tk.escaneaPdf'), ANCHO / 2, y, { align: 'center' });
    y += 5;
  } else {
    $('#tkMsg').textContent = tr('tk.sinQr');
  }

  y += 2;
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8);
  doc.text(tr('tk.gracias'), ANCHO / 2, y, { align: 'center' });

  const p = n => String(n).padStart(2, '0');
  const s = t.salida;
  const sello = `${s.getFullYear()}${p(s.getMonth() + 1)}${p(s.getDate())}-${p(s.getHours())}${p(s.getMinutes())}`;
  doc.save(`ticket-${t.placa}-${sello}.pdf`);
  narrar(tr('tk.pdfVoz'));
}

$('#tkPdf').onclick = descargarPdf;
$('#tkImprimir').onclick = () => window.print();