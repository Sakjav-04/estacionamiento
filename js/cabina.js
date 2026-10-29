// Cabina de inspeccion del vehiculo: 4 fotos (frente, lado izquierdo, atras, lado derecho)
// y marcado de danos sobre cada foto con gestos de DOS manos (MediaPipe Hands).
// Tambien funciona con el mouse o con el dedo en pantallas tactiles. Todo ocurre en el navegador.
//
// Gestos (persona diestra; con el boton "Lapiz: mano ..." se intercambian las manos):
//   Mano del lapiz (derecha). El cursor queda entre el pulgar y el indice.
//     - Pellizco en un espacio vacio: crea una marca del dano elegido. Arrastra para darle tamano
//       (en "Rayon" recorres el rayon). Suelta el pellizco para dejarla.
//     - Pellizco sobre una marca: la mueves. Sueltala sobre el bote para borrarla.
//     - Pellizco (o dejar el cursor quieto) sobre un boton de la pantalla: lo pulsa.
//   Mano de la paleta (izquierda).
//     - Muestra de 1 a 5 dedos: eliges el tipo de dano (1 Rayon ... 5 Pieza faltante).
//     - Pulgar arriba 1 segundo: vista revisada, pasa a la siguiente.
//     - Pellizco con las dos manos: separas / juntas para el tamano y giras para rotar la marca.
//   Al tomar la foto: mano abierta 1 segundo y empieza una cuenta regresiva de 3.
// Mouse / dedo: arrastra para marcar o mover, rueda = tamano, Shift + rueda = girar,
// dos dedos sobre la pantalla = tamano y giro, teclas 1-5 = tipo, Supr = borrar, Ctrl+Z = deshacer.
import { C, doc, getDoc } from './firebase.js';
import { $, esc, narrar, toast } from './utils.js';
import { t, tp } from './i18n.js';

// Estilos propios de la cabina (se cargan solos, no hace falta tocar index.html)
if (!document.querySelector('link[href="css/cabina.css"]')) {
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = 'css/cabina.css';
  document.head.appendChild(css);
}

// ---------- Catalogos ----------
export const VISTAS = ['frente', 'izq', 'atras', 'der'];   // orden en que se rodea el auto
export const TIPOS = [
  { id: 'rayon',      forma: 'trazo',    color: '#facc15' },
  { id: 'abolladura', forma: 'circulo',  color: '#ef4444' },
  { id: 'golpe',      forma: 'estrella', color: '#fb923c' },
  { id: 'vidrio',     forma: 'rect',     color: '#38bdf8' },
  { id: 'faltante',   forma: 'cruz',     color: '#c084fc' }
];
const tipoDe = id => TIPOS.find(x => x.id === id) || TIPOS[0];

const W = 960;              // ancho interno del escenario (el alto depende de la foto)
const ANCHO_FOTO = 640;     // ancho de las fotos que se guardan
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';
const MARGEN = 0.1;         // no hace falta llegar a la orilla de la camara para llegar a la orilla de la foto
const MS_TIPO = 350, MS_PULGAR = 900, MS_BOTON = 900, MS_PALMA = 800, GRACIA = 300;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const r3 = v => Math.round(v * 1000) / 1000;
const angulo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const medio = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// ---------- Textos (los usan panel.js y ticket.js) ----------
// Zona aproximada del dano segun la vista y el tercio de la foto donde quedo la marca.
// En las siluetas laterales el frente del auto queda: a la izquierda (lado izq.) y a la derecha (lado der.).
const COLS = {
  frente: ['der', 'centro', 'izq'],          // viendo el frente, el lado derecho del auto queda a tu izquierda
  atras: ['izq', 'centro', 'der'],
  izq: ['delantera', 'centro', 'trasera'],
  der: ['trasera', 'centro', 'delantera']
};
const FILAS = ['arriba', 'medio', 'abajo'];
export const zona = (vista, u, v) =>
  COLS[vista][Math.min(2, Math.floor(clamp(u) * 3))] + '-' + FILAS[Math.min(2, Math.floor(clamp(v) * 3))];
export const zonaTexto = z => String(z || '').split('-').map(k => t('z.' + k)).join(' · ');
export const nombreVista = v => t('v.' + v);
export const nombreTipo = id => t('td.' + id);

// { rayon: 2, abolladura: 1 } -> "2 rayones, 1 abolladura"
export function textoDanos(resumen) {
  const partes = TIPOS.filter(x => resumen && resumen[x.id]).map(x => tp('dn.' + x.id, resumen[x.id]));
  return partes.length ? partes.join(', ') : t('ins.sinDanos');
}

// Traduce los errores de la camara a un mensaje entendible
export const msjCamara = e => {
  if (e.name === 'NotAllowedError') return t('cam.denegado');
  if (e.name === 'NotFoundError') return t('cam.noEncontrada');
  if (e.name === 'NotReadableError') return t('cam.ocupada');
  if (String(e.message).startsWith('cam.')) return t(e.message);
  return e.message || t('cam.error');
};

// Miniaturas 2x2 de una inspeccion (panel y ticket)
export const miniaturasHtml = fotos => `<div class="ins-mini">${(fotos || []).map(f => `
  <figure><img src="${esc(f.img)}" alt="${esc(nombreVista(f.vista))}">
  <figcaption>${esc(nombreVista(f.vista))}${f.danos && f.danos.length ? ` · ${f.danos.length}` : ''}</figcaption></figure>`).join('')}</div>`;

// Las fotos de la inspeccion viven en la coleccion "inspecciones" (un documento por registro),
// asi la lista de clientes no descarga 4 fotos de cada auto.
const cache = new Map();
export function cargarInspeccion(rid) {
  if (!rid) return Promise.resolve(null);
  if (!cache.has(rid)) {
    cache.set(rid, getDoc(doc(C.i, rid))
      .then(d => (d.exists() ? d.data() : null))
      .catch(() => { cache.delete(rid); return null; }));
  }
  return cache.get(rid);
}

// Ventana para ver una inspeccion guardada (fotos grandes y lista de danos)
let dlgVer = null;
export function mostrarInspeccion(d) {
  if (!dlgVer) {
    dlgVer = document.createElement('dialog');
    dlgVer.id = 'dlgVerIns';
    document.body.appendChild(dlgVer);
  }
  dlgVer.innerHTML = `<article>
    <header><strong>${t('ins.titulo')}</strong> <small>${esc(textoDanos(d.resumen))}</small></header>
    <div class="ver-cuerpo">${(d.fotos || []).map(f => `<figure>
      <img src="${esc(f.img)}" alt="${esc(nombreVista(f.vista))}">
      <figcaption><b>${esc(nombreVista(f.vista))}</b>
      ${f.danos && f.danos.length
        ? `<ol>${f.danos.map(x => `<li>${esc(nombreTipo(x.tipo))} <small>${esc(zonaTexto(x.zona))}</small></li>`).join('')}</ol>`
        : `<span>${t('ins.sinDanos')}</span>`}</figcaption></figure>`).join('')}</div>
    <footer><button type="button">${t('tk.cerrar')}</button></footer></article>`;
  dlgVer.querySelector('footer button').onclick = () => dlgVer.close();
  dlgVer.showModal();
}

// ---------- Estado de la cabina ----------
const nuevasVistas = () => VISTAS.map(() => ({ foto: null, marcas: [], revisada: false }));
let vistas = nuevasVistas();
let iv = 0;                 // vista actual
let fase = 'captura';       // 'captura' | 'marcar' | 'resumen'
let H = 540;                // alto del escenario (sigue la proporcion de la foto)
let inspeccion = null;      // resultado listo para guardar en Firebase
let alTerminar = null;      // aviso para el panel cuando se cierra la cabina

let tipo = TIPOS[0].id;
let zurdo = false;
try { zurdo = localStorage.getItem('cabZurdo') === '1'; } catch (e) { /* nada */ }

let sel = null, nuevo = null, agarre = null, trans = null, enBasura = false;
let historial = [], antes = null, tRueda = 0;
let dlg = null, escena = null, video = null, lienzo = null, g = null;
let stream = null, real = null, sinTrasera = false, espejo = true, cola = Promise.resolve();
let hands = null, cargaMP = null, mpOk = false, mpError = false, enviando = false;
let corriendo = false, raf = 0, ultimaMano = 0;
let palmaDesde = 0, palmaPos = null, cuentaHasta = 0, ultimoN = 0;
let dwell = null;
let firma = '';             // para no repintar los pasos si nada cambio

const marcas = () => vistas[iv].marcas;

export const getInspeccion = () => inspeccion;

export function limpiarInspeccion() {
  inspeccion = null;
  vistas = nuevasVistas();
  alTerminar = null;
  if (dlg && dlg.open) dlg.close();
}

// ---------- Suavizado del cursor (filtro "One Euro") ----------
// Quieto: casi no tiembla. Rapido: sigue la mano sin retraso.
class Suave {
  constructor(min = 1.2, beta = 0.012) { this.min = min; this.beta = beta; this.reset(); }
  reset() { this.x = null; }
  paso(p, ms) {
    const s = ms / 1000;
    if (!this.x) { this.x = p; this.dx = { x: 0, y: 0 }; this.t = s; return p; }
    const dt = Math.max(1e-3, s - this.t); this.t = s;
    const alfa = fc => { const r = 2 * Math.PI * fc * dt; return r / (r + 1); };
    const ad = alfa(1);
    this.dx = { x: this.dx.x + ad * ((p.x - this.x.x) / dt - this.dx.x), y: this.dx.y + ad * ((p.y - this.x.y) / dt - this.dx.y) };
    const a = alfa(this.min + this.beta * Math.hypot(this.dx.x, this.dx.y));
    this.x = { x: this.x.x + a * (p.x - this.x.x), y: this.x.y + a * (p.y - this.x.y) };
    return this.x;
  }
}

// Estado de cada mano: pri = la del lapiz, sec = la de la paleta
const nuevaMano = () => ({
  mano: true, lm: null, p: null, visto: 0, f: new Suave(), pinch: false, on: 0, off: 0,
  empezo: false, termino: false, enBoton: false, dedos: 0, pulgar: false,
  dedosVal: -1, dedosDesde: 0, pulgarDesde: 0, pulgarHecho: false
});
let manos = { pri: nuevaMano(), sec: nuevaMano() };
// Mouse o dedos sobre la pantalla (a = primer puntero, b = segundo)
const nuevoPuntero = () => ({ mano: false, p: null, pinch: false, empezo: false, termino: false, enBoton: false });
const ptr = { a: nuevoPuntero(), b: nuevoPuntero() };
const punteros = new Map();

const rolP = () => (ptr.a.pinch || ptr.a.empezo || ptr.a.termino ? ptr.a : manos.pri);
const rolS = () => (ptr.b.pinch || ptr.b.empezo || ptr.b.termino ? ptr.b : manos.sec);

// ---------- Lectura de la mano ----------
const palma = lm => dist(lm[0], lm[9]) || 1e-3;
const extendido = (lm, punta, art) => dist(lm[punta], lm[0]) > dist(lm[art], lm[0]) * 1.1;
// Pulgar afuera: su punta se aleja de la base del menique mas que su articulacion
const pulgarFuera = (lm, pal) => dist(lm[4], lm[17]) > dist(lm[3], lm[17]) * 1.05 && dist(lm[4], lm[9]) / pal > 0.6;

function leerMano(lm) {
  const pal = palma(lm);
  const cuatro = [[8, 6], [12, 10], [16, 14], [20, 18]].filter(([a, b]) => extendido(lm, a, b)).length;
  const arriba = cuatro === 0 && lm[4].y < lm[3].y && lm[3].y < lm[2].y &&
    (lm[2].y - lm[4].y) / pal > 0.3 && lm[4].y < lm[6].y;
  return { dedos: cuatro + (pulgarFuera(lm, pal) ? 1 : 0), arriba, pinza: dist(lm[4], lm[8]) / pal };
}

// Coordenadas de la camara (0..1) -> escenario en pixeles
function aEscena(nx, ny) {
  const x = espejo ? 1 - nx : nx;
  return {
    x: clamp((x - MARGEN) / (1 - 2 * MARGEN)) * W,
    y: clamp((ny - MARGEN) / (1 - 2 * MARGEN)) * H
  };
}

// Decide cual mano es el lapiz y cual la paleta
function asignar(lista, ahora) {
  const xs = h => (espejo ? 1 - h.lm[9].x : h.lm[9].x);
  let pri = null, sec = null;
  if (lista.length >= 2) {
    // Con dos manos manda la posicion: la que esta a la derecha de la pantalla es la derecha
    const [izq, der] = lista.slice(0, 2).sort((a, b) => xs(a) - xs(b));
    pri = zurdo ? izq : der; sec = zurdo ? der : izq;
  } else if (lista.length === 1) {
    const h = lista[0], x = xs(h);
    const cerca = m => m.lm && ahora - m.visto < 400 && Math.abs((espejo ? 1 - m.lm[9].x : m.lm[9].x) - x) < 0.18;
    if (cerca(manos.pri)) pri = h;
    else if (cerca(manos.sec)) sec = h;
    else {
      // MediaPipe nombra las manos como si la imagen estuviera en espejo: con la imagen normal se invierte
      const derecha = espejo ? h.etiqueta === 'Left' : h.etiqueta === 'Right';
      if (derecha !== zurdo) pri = h; else sec = h;
    }
  }
  actualizar(manos.pri, pri, ahora);
  actualizar(manos.sec, sec, ahora);
}

function actualizar(m, h, ahora) {
  if (!h) {
    // Unos milisegundos de gracia: si la deteccion parpadea no se suelta lo que tienes agarrado
    if (m.lm && ahora - m.visto > GRACIA) {
      if (m.pinch) { m.pinch = false; m.termino = true; }
      m.lm = null; m.f.reset(); m.dedosVal = -1; m.pulgarDesde = 0; m.on = m.off = 0;
    }
    return;
  }
  const lm = h.lm, d = leerMano(lm);
  m.lm = lm; m.visto = ahora;
  m.p = m.f.paso(aEscena((lm[4].x + lm[8].x) / 2, (lm[4].y + lm[8].y) / 2), ahora);
  // Pellizco con histeresis: cuesta un poco entrar y un poco salir, asi no parpadea
  if (!m.pinch) {
    m.on = d.pinza < 0.25 ? m.on + 1 : 0;
    if (m.on >= 2) { m.pinch = true; m.empezo = true; m.off = 0; }
  } else {
    m.off = d.pinza > 0.38 ? m.off + 1 : 0;
    if (m.off >= 2) { m.pinch = false; m.termino = true; m.on = 0; }
  }
  m.dedos = d.dedos; m.pulgar = d.arriba;
}

// ---------- Resultados de MediaPipe ----------
function procesar(res) {
  const ahora = performance.now();
  const lista = (res.multiHandLandmarks || []).map((lm, i) => ({
    lm, etiqueta: (res.multiHandedness && res.multiHandedness[i] && res.multiHandedness[i].label) || ''
  }));
  if (lista.length) ultimaMano = ahora;
  if (fase === 'captura') return gestoCaptura(lista, ahora);
  if (fase !== 'marcar') return;
  asignar(lista, ahora);
  logica(ahora);
}

// Mano abierta 1 segundo -> cuenta regresiva -> foto
function gestoCaptura(lista, ahora) {
  if (cuentaHasta) return;
  const abierta = lista.find(h => leerMano(h.lm).dedos === 5);
  if (!abierta) { palmaDesde = 0; palmaPos = null; return; }
  palmaPos = { x: abierta.lm[9].x * W, y: abierta.lm[9].y * H };   // la vista previa no va en espejo
  if (!palmaDesde) palmaDesde = ahora;
  else if (ahora - palmaDesde > MS_PALMA) { palmaDesde = 0; palmaPos = null; cuentaHasta = ahora + 3000; ultimoN = 0; }
}

// ---------- Logica de edicion (la usan las manos y el mouse) ----------
function logica(ahora) {
  const P = rolP(), S = rolS();
  if (P.empezo) { P.empezo = false; empezar(P, S); }
  S.empezo = false;

  const dos = P.pinch && S.pinch && P.p && S.p && !P.enBoton;
  // Si las dos manos pellizcan casi al mismo tiempo, la marca recien empezada se descarta
  if (dos && nuevo && sel && esDiminuta(nuevo)) nuevo = null;
  if (dos && !trans && !nuevo) {
    const o = agarre ? agarre.o : sel;
    if (o) {
      abrirCambio();
      trans = { o, d0: Math.max(30, dist(P.p, S.p)), a0: angulo(P.p, S.p), m0: medio(P.p, S.p), s0: o.s, r0: o.r, x0: o.x, y0: o.y };
      agarre = null; enBasura = false;
    }
  }
  if (trans && !dos) {
    const o = trans.o;
    trans = null;
    if (P.pinch && P.p) agarre = { o, p0: { ...P.p }, x0: o.x, y0: o.y };
  }
  if (trans) {
    const o = trans.o, m = medio(P.p, S.p);
    o.s = clamp(trans.s0 * dist(P.p, S.p) / trans.d0, 0.3, 6);
    o.r = trans.r0 + angulo(P.p, S.p) - trans.a0;
    o.x = clamp(trans.x0 + m.x - trans.m0.x, 0, W);
    o.y = clamp(trans.y0 + m.y - trans.m0.y, 0, H);
  } else if (P.pinch && P.p && !P.enBoton) arrastrar(P.p);

  if (P.termino) { P.termino = false; soltar(P); }
  S.termino = false;

  if (S.mano && S.lm && !S.pinch) paleta(S, ahora);
  if (P.mano && P.lm && !P.pinch) permanecer(P, ahora); else if (!P.pinch) dwell = null;
  if (!agarre && !nuevo && !trans) cerrarCambio();
}

function empezar(P, S) {
  P.enBoton = false;
  const p = P.p;
  if (!p) return;
  const b = botonEn(p);
  if (b) { P.enBoton = true; pulsar(b); return; }
  if (S.pinch && sel) return;                   // es un pellizco a dos manos sobre la marca elegida
  const o = marcaEn(p);
  abrirCambio();
  if (o) { sel = o; agarre = { o, p0: { ...p }, x0: o.x, y0: o.y }; tic(660); }
  else { nuevo = crearMarca(p); tic(520); }
}

function arrastrar(p) {
  if (agarre) {
    const o = agarre.o;
    o.x = clamp(agarre.x0 + p.x - agarre.p0.x, 0, W);
    o.y = clamp(agarre.y0 + p.y - agarre.p0.y, 0, H);
    enBasura = dist(p, basura()) < basura().r;
  } else if (nuevo) crecer(nuevo, p);
}

function soltar(P) {
  if (P.enBoton) { P.enBoton = false; return; }
  if (agarre) {
    if (enBasura) {
      const ms = marcas(), i = ms.indexOf(agarre.o);
      if (i >= 0) ms.splice(i, 1);
      if (sel === agarre.o) sel = null;
      tic(300);
    }
    agarre = null; enBasura = false;
  } else if (nuevo) {
    terminarMarca(nuevo);
    marcas().push(nuevo);
    sel = nuevo; nuevo = null;
    tic(780);
  }
}

// Mano de la paleta: dedos = tipo de dano, pulgar arriba = siguiente vista
function paleta(S, ahora) {
  if (S.pulgar) {
    S.dedosVal = -1;
    if (S.pulgarHecho) return;
    if (!S.pulgarDesde) S.pulgarDesde = ahora;
    else if (ahora - S.pulgarDesde > MS_PULGAR) { S.pulgarHecho = true; S.pulgarDesde = 0; siguiente(); }
    return;
  }
  S.pulgarDesde = 0; S.pulgarHecho = false;
  const n = S.dedos;
  if (n !== S.dedosVal) { S.dedosVal = n; S.dedosDesde = ahora; }
  else if (n >= 1 && n <= TIPOS.length && !nuevo && ahora - S.dedosDesde > MS_TIPO && tipo !== TIPOS[n - 1].id) {
    elegirTipo(TIPOS[n - 1].id);
  }
}

// Dejar el cursor quieto sobre un boton lo pulsa
function permanecer(P, ahora) {
  const b = P.p && botonEn(P.p);
  if (!b) { dwell = null; return; }
  if (!dwell || dwell.id !== b.id) dwell = { id: b.id, t0: ahora, hecho: false };
  else if (!dwell.hecho && ahora - dwell.t0 > MS_BOTON) { dwell.hecho = true; pulsar(b); }
}

function elegirTipo(id) {
  if (tipo === id) return;
  tipo = id; tic(880);
}

// Historial para deshacer: se guarda una copia antes de cada cambio
function abrirCambio() { if (antes === null) antes = JSON.stringify(marcas()); }
function cerrarCambio() {
  if (antes === null) return;
  if (antes !== JSON.stringify(marcas())) {
    historial.push(antes);
    if (historial.length > 40) historial.shift();
    inspeccion = null;                          // hubo cambios: hay que volver a guardar
  }
  antes = null;
}
function deshacer() {
  if (!historial.length || nuevo || agarre || trans) return;
  vistas[iv].marcas = JSON.parse(historial.pop());
  sel = null; inspeccion = null; tic(420);
}
function borrarSel() {
  if (!sel) return;
  abrirCambio();
  const ms = marcas(), i = ms.indexOf(sel);
  if (i >= 0) ms.splice(i, 1);
  sel = null;
  cerrarCambio();
}

// ---------- Marcas ----------
function crearMarca(p) {
  const f = tipoDe(tipo).forma;
  return { tipo, x: p.x, y: p.y, s: 1, r: 0, tam: 0, pts: f === 'trazo' ? [[0, 0]] : null };
}
function crecer(m, p) {
  if (m.pts) {
    const [lx, ly] = m.pts[m.pts.length - 1], nx = p.x - m.x, ny = p.y - m.y;
    if (Math.hypot(nx - lx, ny - ly) > 3) m.pts.push([nx, ny]);
  } else m.tam = dist(m, p);
}
const esDiminuta = m => (m.pts ? m.pts.length < 4 : m.tam < 12);
function terminarMarca(m) {
  if (m.pts) {
    if (m.pts.length < 3) m.pts = [[-35, 0], [35, 0]];      // un toque deja un rayon corto
    const [x1, y1, x2, y2] = caja(m), cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    m.pts = m.pts.map(([x, y]) => [x - cx, y - cy]);         // el centro queda en medio del trazo
    m.x += cx; m.y += cy;
  } else if (m.tam < 18) m.tam = 40;                          // un toque deja una marca de tamano normal
}

// Caja de la marca en sus coordenadas locales: [x1, y1, x2, y2]
function caja(m) {
  const f = tipoDe(m.tipo).forma, k = m.tam || 40;
  if (f === 'trazo') {
    const xs = m.pts.map(q => q[0]), ys = m.pts.map(q => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  if (f === 'rect') return [-1.25 * k, -0.85 * k, 1.25 * k, 0.85 * k];
  return [-k, -k, k, k];
}
function aLocal(m, p) {
  const dx = p.x - m.x, dy = p.y - m.y, c = Math.cos(m.r), s = Math.sin(m.r);
  return { x: (dx * c + dy * s) / m.s, y: (-dx * s + dy * c) / m.s };
}
function marcaEn(p) {
  const ms = marcas();
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i], q = aLocal(m, p), [x1, y1, x2, y2] = caja(m), k = 16 / m.s;
    if (q.x >= x1 - k && q.x <= x2 + k && q.y >= y1 - k && q.y <= y2 + k) return m;
  }
  return null;
}

function trazar(c, m) {
  const f = tipoDe(m.tipo).forma, k = m.tam || 40;
  c.beginPath();
  if (f === 'trazo') m.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  else if (f === 'circulo') c.arc(0, 0, k, 0, Math.PI * 2);
  else if (f === 'estrella') {
    for (let i = 0; i < 16; i++) {
      const r = i % 2 ? k * 0.58 : k, a = -Math.PI / 2 + i * Math.PI / 8;
      i ? c.lineTo(r * Math.cos(a), r * Math.sin(a)) : c.moveTo(r * Math.cos(a), r * Math.sin(a));
    }
    c.closePath();
  } else if (f === 'rect') {
    c.rect(-1.25 * k, -0.85 * k, 2.5 * k, 1.7 * k);
    c.moveTo(-0.5 * k, -0.85 * k); c.lineTo(-0.1 * k, -0.2 * k); c.lineTo(-0.35 * k, 0.2 * k); c.lineTo(0.2 * k, 0.85 * k);
  } else {   // cruz: pieza faltante
    c.arc(0, 0, k, 0, Math.PI * 2);
    c.moveTo(-0.55 * k, -0.55 * k); c.lineTo(0.55 * k, 0.55 * k);
    c.moveTo(0.55 * k, -0.55 * k); c.lineTo(-0.55 * k, 0.55 * k);
  }
}

// k = escala de salida (1 en pantalla; menor al generar la foto que se guarda)
function pintarMarca(c, m, k = 1, resaltada = false) {
  const col = tipoDe(m.tipo).color;
  c.save();
  c.translate(m.x * k, m.y * k); c.rotate(m.r); c.scale(m.s * k, m.s * k);
  c.lineJoin = 'round'; c.lineCap = 'round';
  trazar(c, m);
  c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 8 / m.s; c.stroke();   // borde oscuro: se ve sobre cualquier color
  c.strokeStyle = col; c.lineWidth = 4.5 / m.s; c.stroke();
  if (resaltada) {
    const [x1, y1, x2, y2] = caja(m), e = 12 / m.s;
    c.setLineDash([8 / m.s, 6 / m.s]); c.lineWidth = 2 / m.s; c.strokeStyle = '#fff';
    c.strokeRect(x1 - e, y1 - e, x2 - x1 + 2 * e, y2 - y1 + 2 * e);
  }
  c.restore();
}

function pintarNumero(c, m, n, k = 1) {
  const [x1, y1, x2, y2] = caja(m);
  const R = Math.max(Math.abs(x1), Math.abs(x2), Math.abs(y1), Math.abs(y2)) * m.s;
  const x = (m.x + R * 0.72 + 6) * k, y = (m.y - R * 0.72 - 6) * k, r = Math.max(10, 14 * k);
  c.save();
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = tipoDe(m.tipo).color; c.fill();
  c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,.7)'; c.stroke();
  c.fillStyle = '#111'; c.font = `700 ${Math.round(r * 1.2)}px Barlow, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String(n), x, y + 1);
  c.restore();
}

// ---------- Botones dibujados en el escenario (se pulsan con la mano o con el mouse) ----------
function botones() {
  if (fase !== 'marcar') return [];
  const bw = 168, gap = 8, x0 = (W - (bw * 5 + gap * 4)) / 2;
  const lista = TIPOS.map((x, i) => ({
    id: 'tipo-' + x.id, x: x0 + i * (bw + gap), y: 10, w: bw, h: 42, color: x.color,
    texto: `${i + 1} · ${nombreTipo(x.id)}`, activo: tipo === x.id, accion: () => elegirTipo(x.id)
  }));
  lista.push({ id: 'deshacer', x: W - 418, y: H - 54, w: 160, h: 42, texto: t('ins.deshacer'), off: !historial.length, accion: deshacer });
  lista.push({ id: 'sig', x: W - 250, y: H - 54, w: 240, h: 42, texto: textoSig(), principal: true, accion: siguiente });
  return lista;
}
const botonEn = p => botones().find(b => !b.off && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
function pulsar(b) { tic(990); b.accion(); }
const basura = () => ({ x: 62, y: H - 62, r: 46 });

function textoSig() {
  const otras = vistas.some((v, i) => i !== iv && !v.revisada);
  if (!marcas().length) return t('ins.sinDanosSig');
  return otras ? t('ins.siguiente') : t('ins.verResumen');
}

// ---------- Navegacion entre vistas ----------
function siguiente() {
  if (fase !== 'marcar' || nuevo || agarre || trans) return;
  vistas[iv].revisada = true;
  tic(1180);
  narrar(t('ins.vistaVoz', { vista: nombreVista(VISTAS[iv]) }));
  const sig = [1, 2, 3].map(d => (iv + d) % 4).find(j => !vistas[j].revisada);
  if (sig === undefined) aResumen(); else irA(sig);
}

function irA(i) {
  iv = i;
  sel = nuevo = agarre = trans = null;
  historial = []; antes = null; dwell = null; enBasura = false;
  palmaDesde = 0; palmaPos = null; cuentaHasta = 0;
  return vistas[i].foto ? aMarcar() : aCaptura();
}

async function aCaptura() {
  fase = 'captura';
  mostrarEscena();
  try { await camara('auto'); } catch (e) { toast(msjCamara(e)); return; }
  if (fase !== 'captura') return;
  espejo = false;                             // la foto del auto se ve tal cual
  tamano(video.videoWidth || 16, video.videoHeight || 9);
  cargarManos();
}

async function aMarcar() {
  fase = 'marcar';
  const f = vistas[iv].foto;
  tamano(f.width, f.height);
  mostrarEscena();
  try {
    await camara('manos');
    if (fase === 'marcar') espejo = real !== 'environment';
  } catch (e) { toast(msjCamara(e)); }
  cargarManos();
}

function aResumen() {
  fase = 'resumen';
  apagar();
  mostrarEscena();
  const total = contar();
  $('#cabResumen').innerHTML = `<div class="cab-res-grid">${vistas.map((v, i) => `
    <button type="button" class="cab-res-item" data-i="${i}">
      <img src="${componer(v, 0.6, 320)}" alt="${esc(nombreVista(VISTAS[i]))}">
      <b>${esc(nombreVista(VISTAS[i]))}</b>
      <span>${v.marcas.length
        ? v.marcas.map((m, j) => `${j + 1}. ${esc(nombreTipo(m.tipo))}`).join(' · ')
        : t('ins.sinDanos')}</span>
    </button>`).join('')}</div>
    <p class="cab-res-total"><b>${t('ins.total')}:</b> ${esc(textoDanos(total))}</p>`;
  $('#cabResumen').querySelectorAll('[data-i]').forEach(b => { b.onclick = () => irA(Number(b.dataset.i)); });
}

function tomarFoto() {
  if (fase !== 'captura') return;
  const w = video.videoWidth, h = video.videoHeight;
  if (!stream || !w || !h) { toast(t('cam.noLista')); return; }
  const k = Math.min(1, 1280 / w), cv = document.createElement('canvas');
  cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
  const v = vistas[iv];
  v.foto = cv; v.marcas = []; v.revisada = false;
  inspeccion = null; cuentaHasta = 0; palmaDesde = 0; palmaPos = null; historial = [];
  tic(1320);
  narrar(t('cam.fotoVoz'));
  aMarcar();
}

function repetirFoto() {
  if (fase !== 'marcar') return;
  const v = vistas[iv];
  v.foto = null; v.marcas = []; v.revisada = false;
  inspeccion = null;
  irA(iv);
}

// ---------- Resultado ----------
function contar() {
  const r = {};
  vistas.forEach(v => v.marcas.forEach(m => { r[m.tipo] = (r[m.tipo] || 0) + 1; }));
  return r;
}

// Foto final con las marcas dibujadas encima (JPEG)
function componer(v, calidad = 0.7, ancho = ANCHO_FOTO) {
  const f = v.foto, k = ancho / W, cv = document.createElement('canvas');
  cv.width = ancho; cv.height = Math.round(ancho * f.height / f.width);
  const c = cv.getContext('2d');
  c.drawImage(f, 0, 0, cv.width, cv.height);
  v.marcas.forEach(m => pintarMarca(c, m, k));
  v.marcas.forEach((m, i) => pintarNumero(c, m, i + 1, k));
  return cv.toDataURL('image/jpeg', calidad);
}

function datosVista(v, i, calidad) {
  const hv = W * v.foto.height / v.foto.width;
  return {
    vista: VISTAS[i], img: componer(v, calidad), sin_danos: !v.marcas.length,
    danos: v.marcas.map((m, j) => ({
      n: j + 1, tipo: m.tipo, zona: zona(VISTAS[i], m.x / W, m.y / hv), x: r3(m.x / W), y: r3(m.y / hv)
    }))
  };
}

function guardar() {
  if (vistas.some(v => !v.foto || !v.revisada)) return;
  // Un documento de Firestore admite 1 MB: si las fotos pesan mucho se bajan de calidad
  let calidad = 0.7, fotos;
  do {
    fotos = vistas.map((v, i) => datosVista(v, i, calidad));
    calidad -= 0.1;
  } while (fotos.reduce((s, f) => s + f.img.length, 0) > 850000 && calidad > 0.3);
  const resumen = contar();
  inspeccion = { fotos, resumen, total: Object.values(resumen).reduce((a, b) => a + b, 0) };
  narrar(t('ins.listaVoz', { resumen: textoDanos(resumen) }));
  dlg.close();
}

// ---------- Camara ----------
// modo 'auto' = camara trasera (para fotografiar el auto); 'manos' = camara frontal (para los gestos).
// En una PC con una sola camara se usa la misma para todo y no se reabre.
function camara(modo) {
  const p = cola.then(() => abrirCam(modo));
  cola = p.catch(() => {});
  return p;
}
async function abrirCam(modo) {
  const quiere = modo === 'auto' ? 'environment' : 'user';
  if (stream) {
    if (real === quiere || sinTrasera) return;
    if (quiere === 'user' && real !== 'environment') return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('cam.https');
  apagar();
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: quiere }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
  });
  const ajustes = stream.getVideoTracks()[0].getSettings ? stream.getVideoTracks()[0].getSettings() : {};
  real = ajustes.facingMode === 'environment' ? 'environment' : 'user';
  if (quiere === 'environment' && real !== 'environment') sinTrasera = true;
  video.srcObject = stream;
  await video.play();
  if (!corriendo) apagar();                   // se cerro la cabina mientras abria la camara
}
function apagar() {
  if (stream) stream.getTracks().forEach(x => x.stop());
  stream = null; real = null;
  if (video) video.srcObject = null;
}

// MediaPipe se descarga solo la primera vez que se abre la cabina (pesa varios MB)
function cargarManos() {
  if (cargaMP) return cargaMP;
  cargaMP = new Promise((res, rej) => {
    if (window.Hands) return res();
    const s = document.createElement('script');
    s.src = MP + 'hands.js'; s.crossOrigin = 'anonymous';
    s.onload = res; s.onerror = () => rej(new Error('mp'));
    document.head.appendChild(s);
  }).then(() => {
    hands = new window.Hands({ locateFile: f => MP + f });
    hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
    hands.onResults(procesar);
    return hands.initialize ? hands.initialize() : null;
  }).then(() => { mpOk = true; })
    .catch(() => { mpError = true; });
  return cargaMP;
}

function bucle() {
  if (!corriendo) return;
  raf = requestAnimationFrame(bucle);
  if (mpOk && !enviando && fase !== 'resumen' && stream && video.readyState >= 2) {
    enviando = true;
    hands.send({ image: video }).catch(() => {}).finally(() => { enviando = false; });
  }
  dibujar();
}

// ---------- Dibujo ----------
function tamano(w, h) {
  H = Math.round(W * h / w) || 540;
  lienzo.width = W; lienzo.height = H;
  escena.style.setProperty('--prop', String(W / H));
}

function dibujar() {
  const ahora = performance.now();
  if (fase === 'captura') dibujarCaptura(ahora);
  else if (fase === 'marcar') dibujarMarcado(ahora);
  ui(ahora);
}

function dibujarCaptura(ahora) {
  g.clearRect(0, 0, W, H);
  silueta(VISTAS[iv]);
  if (palmaDesde && palmaPos) anillo(palmaPos.x, palmaPos.y, 48, clamp((ahora - palmaDesde) / MS_PALMA), '#22c55e');
  if (cuentaHasta) {
    const n = Math.ceil((cuentaHasta - ahora) / 1000);
    if (n <= 0) { tomarFoto(); return; }
    if (n !== ultimoN) { ultimoN = n; tic(700); }
    g.save();
    g.font = `700 ${Math.round(H * 0.35)}px "Barlow Condensed", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(String(n), W / 2, H / 2);
    g.fillStyle = '#fff'; g.fillText(String(n), W / 2, H / 2);
    g.restore();
  }
}

function dibujarMarcado(ahora) {
  const v = vistas[iv];
  g.clearRect(0, 0, W, H);
  g.drawImage(v.foto, 0, 0, W, H);
  const P = rolP(), S = rolS();
  const sobre = P.p && !P.pinch && !agarre && !nuevo ? marcaEn(P.p) : null;
  v.marcas.forEach(m => pintarMarca(g, m, 1, m === sel || m === sobre));
  v.marcas.forEach((m, i) => pintarNumero(g, m, i + 1));
  if (nuevo) pintarMarca(g, nuevo);

  // Bote de basura (aparece al mover una marca)
  if (agarre) {
    const b = basura();
    g.save();
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    g.fillStyle = enBasura ? 'rgba(220,38,38,.9)' : 'rgba(15,23,42,.75)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
    g.strokeRect(b.x - 13, b.y - 10, 26, 28);
    g.beginPath(); g.moveTo(b.x - 18, b.y - 14); g.lineTo(b.x + 18, b.y - 14);
    g.moveTo(b.x - 5, b.y - 19); g.lineTo(b.x + 5, b.y - 19); g.stroke();
    g.restore();
  }

  botones().forEach(b => pintarBoton(b, dwell && dwell.id === b.id && !dwell.hecho ? clamp((ahora - dwell.t0) / MS_BOTON) : 0));

  // Cursores de las manos
  if (S.mano && S.lm && S.p) {
    const col = tipoDe(tipo).color;
    g.save();
    g.beginPath(); g.arc(S.p.x, S.p.y, 17, 0, Math.PI * 2);
    g.fillStyle = 'rgba(15,23,42,.75)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = S.pinch ? '#00e5ff' : col; g.stroke();
    g.fillStyle = '#fff'; g.font = '700 16px Barlow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(S.pulgar ? 'OK' : S.dedos ? String(S.dedos) : '·', S.p.x, S.p.y + 1);
    g.restore();
    if (S.pulgarDesde) anillo(S.p.x, S.p.y, 26, clamp((ahora - S.pulgarDesde) / MS_PULGAR), '#22c55e');
    else if (S.dedosVal >= 1 && S.dedosVal <= TIPOS.length && TIPOS[S.dedosVal - 1].id !== tipo) {
      anillo(S.p.x, S.p.y, 26, clamp((ahora - S.dedosDesde) / MS_TIPO), TIPOS[S.dedosVal - 1].color);
    }
  }
  if (P.mano && P.lm && P.p) {
    const col = tipoDe(tipo).color;
    g.save();
    g.beginPath(); g.arc(P.p.x, P.p.y, P.pinch ? 8 : 12, 0, Math.PI * 2);
    g.fillStyle = P.pinch ? col : 'rgba(255,255,255,.25)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = P.pinch ? '#00e5ff' : '#fff'; g.stroke();
    if (!P.pinch) { g.beginPath(); g.arc(P.p.x, P.p.y, 3, 0, Math.PI * 2); g.fillStyle = col; g.fill(); }
    g.restore();
  }
}

function anillo(x, y, r, prog, color) {
  if (prog <= 0) return;
  g.save();
  g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
  g.lineWidth = 6; g.strokeStyle = color; g.lineCap = 'round'; g.stroke();
  g.restore();
}

function pintarBoton(b, prog) {
  g.save();
  g.globalAlpha = b.off ? 0.45 : 1;
  g.beginPath();
  if (g.roundRect) g.roundRect(b.x, b.y, b.w, b.h, 10); else g.rect(b.x, b.y, b.w, b.h);
  g.fillStyle = b.activo ? b.color : b.principal ? 'rgba(22,163,74,.92)' : 'rgba(15,23,42,.8)';
  g.fill();
  g.lineWidth = b.activo ? 3 : 1.5;
  g.strokeStyle = b.activo ? '#fff' : b.color || 'rgba(255,255,255,.6)';
  g.stroke();
  g.fillStyle = b.activo ? '#111' : '#fff';
  g.font = '700 16px Barlow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(b.texto, b.x + b.w / 2, b.y + b.h / 2 + 1, b.w - 12);
  if (prog > 0) { g.fillStyle = '#fff'; g.fillRect(b.x + 6, b.y + b.h - 6, (b.w - 12) * prog, 3); }
  g.restore();
}

// Silueta guia para encuadrar el auto en cada vista
function silueta(vista) {
  const c = g;
  c.save();
  c.beginPath();
  const poli = (pts, P, cerrar = true) => {
    pts.forEach(([u, v], i) => { const [x, y] = P(u, v); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    if (cerrar) c.closePath();
  };
  const circ = (P, u, v, r) => { const [x, y] = P(u, v); c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); };
  const rect = (P, u1, v1, u2, v2) => poli([[u1, v1], [u2, v1], [u2, v2], [u1, v2]], P);

  if (vista === 'izq' || vista === 'der') {
    const bw = Math.min(W * 0.86, H * 0.8 * 2.6), bh = bw / 2.6, x0 = (W - bw) / 2, y0 = H * 0.55 - bh / 2;
    const P = (u, v) => [x0 + (vista === 'der' ? 1 - u : u) * bw, y0 + v * bh];
    poli([[0.02, 0.78], [0, 0.56], [0.04, 0.44], [0.3, 0.36], [0.42, 0.07], [0.7, 0.05], [0.86, 0.33],
      [0.99, 0.38], [1, 0.7], [0.97, 0.8]], P);
    poli([[0.33, 0.37], [0.44, 0.12], [0.68, 0.11], [0.8, 0.35]], P);
    circ(P, 0.21, 0.82, bw * 0.08); circ(P, 0.79, 0.82, bw * 0.08);
  } else {
    const bw = Math.min(W * 0.62, H * 0.82 * 1.3), bh = bw / 1.3, x0 = (W - bw) / 2, y0 = H * 0.52 - bh / 2;
    const P = (u, v) => [x0 + u * bw, y0 + v * bh];
    poli([[0.02, 0.46], [0.98, 0.46], [1, 0.86], [0, 0.86]], P);
    poli([[0.14, 0.46], [0.24, 0.06], [0.76, 0.06], [0.86, 0.46]], P);
    poli([[0.2, 0.43], [0.28, 0.12], [0.72, 0.12], [0.8, 0.43]], P);
    rect(P, 0.06, 0.86, 0.22, 1); rect(P, 0.78, 0.86, 0.94, 1);
    if (vista === 'frente') {
      circ(P, 0.15, 0.6, bw * 0.06); circ(P, 0.85, 0.6, bw * 0.06);
      rect(P, 0.32, 0.56, 0.68, 0.72);
    } else {
      rect(P, 0.05, 0.53, 0.24, 0.64); rect(P, 0.76, 0.53, 0.95, 0.64);
      rect(P, 0.38, 0.66, 0.62, 0.78);
    }
  }
  c.setLineDash([14, 10]); c.lineJoin = 'round';
  c.lineWidth = 7; c.strokeStyle = 'rgba(0,0,0,.5)'; c.stroke();
  c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.95)'; c.stroke();
  c.restore();
}

// ---------- Sonidos cortos de confirmacion ----------
let actx = null;
function tic(frec = 880) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), v = actx.createGain(), t0 = actx.currentTime;
    o.frequency.value = frec; v.gain.value = 0.05;
    o.connect(v).connect(actx.destination);
    v.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    o.start(t0); o.stop(t0 + 0.1);
  } catch (e) { /* sin audio */ }
}

// ---------- Ventana ----------
function crearDialogo() {
  if (dlg) return;
  dlg = document.createElement('dialog');
  dlg.id = 'dlgCabina';
  dlg.innerHTML = `<article>
    <header><strong id="cabTitulo"></strong><nav id="cabPasos" class="cab-pasos"></nav></header>
    <div class="cab-escena" id="cabEscena">
      <video id="cabVideo" playsinline muted></video>
      <canvas id="cabLienzo"></canvas>
    </div>
    <div id="cabResumen" class="cab-resumen" hidden></div>
    <p id="cabEstado" class="cab-estado" role="status" aria-live="polite"></p>
    <footer class="cab-botones">
      <button type="button" id="btnSnap"></button>
      <button type="button" id="btnRepetir" class="outline secondary"></button>
      <button type="button" id="cabZurdo" class="outline secondary"></button>
      <button type="button" id="cabGuardar"></button>
      <button type="button" id="cabCerrar" class="outline secondary"></button>
    </footer>
  </article>`;
  document.body.appendChild(dlg);
  escena = $('#cabEscena'); video = $('#cabVideo'); lienzo = $('#cabLienzo'); g = lienzo.getContext('2d');

  $('#btnSnap').onclick = tomarFoto;
  $('#btnRepetir').onclick = repetirFoto;
  $('#cabZurdo').onclick = () => {
    zurdo = !zurdo;
    try { localStorage.setItem('cabZurdo', zurdo ? '1' : '0'); } catch (e) { /* nada */ }
    manos = { pri: nuevaMano(), sec: nuevaMano() };
  };
  $('#cabGuardar').onclick = guardar;
  $('#cabCerrar').onclick = () => dlg.close();

  dlg.addEventListener('close', () => {
    corriendo = false;
    cancelAnimationFrame(raf);
    apagar();
    nuevo = agarre = trans = null; antes = null; dwell = null; cuentaHasta = 0;
    manos = { pri: nuevaMano(), sec: nuevaMano() };
    punteros.clear(); ptr.a = nuevoPuntero(); ptr.b = nuevoPuntero();
    const cb = alTerminar;
    if (cb) cb(inspeccion);
  });

  // Mouse y pantallas tactiles: el primer puntero es el lapiz y el segundo la otra mano
  const aLienzo = e => {
    const r = lienzo.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  };
  lienzo.addEventListener('pointerdown', e => {
    if (fase !== 'marcar' || punteros.size >= 2) return;
    const k = [...punteros.values()].includes('a') ? 'b' : 'a';
    e.preventDefault();
    lienzo.setPointerCapture(e.pointerId);
    punteros.set(e.pointerId, k);
    const q = ptr[k];
    q.p = aLienzo(e); q.pinch = true; q.empezo = true;
    logica(performance.now());
  });
  lienzo.addEventListener('pointermove', e => {
    const k = punteros.get(e.pointerId);
    if (!k) return;
    ptr[k].p = aLienzo(e);
    logica(performance.now());
  });
  const fin = e => {
    const k = punteros.get(e.pointerId);
    if (!k) return;
    punteros.delete(e.pointerId);
    ptr[k].pinch = false; ptr[k].termino = true;
    logica(performance.now());
  };
  lienzo.addEventListener('pointerup', fin);
  lienzo.addEventListener('pointercancel', fin);
  lienzo.addEventListener('wheel', e => {
    if (fase !== 'marcar' || !sel) return;
    e.preventDefault();
    abrirCambio();
    const d = Math.sign(e.deltaY);
    if (e.shiftKey) sel.r += d * 0.1;
    else sel.s = clamp(sel.s * (d > 0 ? 0.92 : 1.08), 0.3, 6);
    clearTimeout(tRueda);
    tRueda = setTimeout(cerrarCambio, 400);
  }, { passive: false });

  // Teclado (se escucha en todo el documento porque el foco puede quedar fuera del lienzo)
  document.addEventListener('keydown', e => {
    if (!dlg.open || !(e.target instanceof Element) || e.target.closest('input, select, textarea')) return;
    const enBoton = e.target.closest('button');
    if (fase === 'captura' && !enBoton && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); tomarFoto(); }
    if (fase !== 'marcar') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); borrarSel(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); deshacer(); }
    else if (e.key >= '1' && e.key <= String(TIPOS.length)) elegirTipo(TIPOS[Number(e.key) - 1].id);
    else if (e.key === 'Enter' && !enBoton) siguiente();
  });
}

function mostrarEscena() {
  escena.hidden = fase === 'resumen';
  $('#cabResumen').hidden = fase !== 'resumen';
  firma = '';
  ui(performance.now());
}

const poner = (el, txt) => { if (el.textContent !== txt) el.textContent = txt; };
const ver = (el, si) => { if (el.hidden === si) el.hidden = !si; };

// Textos, botones y pasos de la ventana (solo cambia lo que hace falta)
function ui(ahora) {
  if (!dlg) return;
  poner($('#cabTitulo'), fase === 'resumen' ? t('ins.resumen')
    : t('ins.vista', { i: iv + 1, vista: nombreVista(VISTAS[iv]) }));

  const f = [fase, iv, vistas.map(v => (v.revisada ? 2 : v.foto ? 1 : 0)).join(''), t('v.frente')].join('|');
  if (f !== firma) {
    firma = f;
    $('#cabPasos').innerHTML = VISTAS.map((v, i) => `<button type="button" data-i="${i}"
      class="${i === iv && fase !== 'resumen' ? 'actual' : ''} ${vistas[i].revisada ? 'hecha' : ''}">
      ${vistas[i].revisada ? '✓ ' : ''}${esc(nombreVista(v))}</button>`).join('');
    $('#cabPasos').querySelectorAll('[data-i]').forEach(b => { b.onclick = () => irA(Number(b.dataset.i)); });
  }

  ver($('#btnSnap'), fase === 'captura');
  ver($('#btnRepetir'), fase === 'marcar');
  ver($('#cabZurdo'), fase === 'marcar');
  ver($('#cabGuardar'), fase === 'resumen');
  poner($('#btnSnap'), t('p.tomarFoto'));
  poner($('#btnRepetir'), t('p.repetirFoto'));
  poner($('#cabZurdo'), t('ins.lapiz', { mano: t(zurdo ? 'mano.izq' : 'mano.der') }));
  poner($('#cabGuardar'), t('ins.guardar'));
  poner($('#cabCerrar'), t('ins.cerrar'));

  video.classList.toggle('pip', fase === 'marcar');
  video.classList.toggle('espejo', fase === 'marcar' && espejo);
  ver(video, !!stream && fase !== 'resumen');
  lienzo.classList.toggle('editable', fase === 'marcar');

  poner($('#cabEstado'), estadoTexto(ahora));
}

function estadoTexto(ahora) {
  if (fase === 'captura') {
    if (cuentaHasta) return t('ins.cuenta', { n: Math.max(1, Math.ceil((cuentaHasta - ahora) / 1000)) });
    if (!stream) return t('ins.abriendo');
    return t(mpOk ? 'ins.hCaptura' : 'ins.hCapturaSin', { vista: nombreVista(VISTAS[iv]) });
  }
  if (fase === 'marcar') {
    if (trans) return t('ins.hEscalar');
    if (agarre) return t(enBasura ? 'ins.hBorrar' : 'ins.hMover');
    if (nuevo) return t(nuevo.pts ? 'ins.hTrazo' : 'ins.hTam');
    if (mpError) return t('ins.sinModelo');
    if (!mpOk) return t('ins.cargando');
    if (ahora - ultimaMano > 1200) return t('ins.hSinManos');
    return t('ins.hMarcar', { pri: t(zurdo ? 'mano.izq' : 'mano.der'), sec: t(zurdo ? 'mano.der' : 'mano.izq') });
  }
  return t('ins.resumenTip');
}

// ---------- Entrada publica ----------
// cb(inspeccion | null) se llama al cerrar la ventana (con o sin guardar)
export function abrirCabina(cb) {
  alTerminar = cb;
  crearDialogo();
  if (!dlg.open) dlg.showModal();
  corriendo = true;
  cancelAnimationFrame(raf);
  bucle();
  const pend = vistas.findIndex(v => !v.revisada);
  if (pend === -1) aResumen(); else irA(pend);
}

// Si cambia el idioma con la cabina abierta, el resumen se vuelve a escribir
document.addEventListener('idioma', () => { if (dlg && dlg.open && fase === 'resumen') aResumen(); });