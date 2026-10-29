// Instrucciones por voz con la Web Speech API (SpeechRecognition). No necesita librerias.
// Solo funciona en Chrome o Edge, con internet, y en localhost o HTTPS.
// Cada comando hace lo mismo que el boton correspondiente de la pantalla.
import { state } from './state.js';
import { $, toast, hablar, norm, total, money, dur, narradorOn } from './utils.js';
import { panel } from './panel.js';
import { cancelar } from './operaciones.js';
import { t, tp, nombreColor, setIdioma } from './i18n.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const btn = $('#btnVoz'), txt = $('#vozTxt');

let rec = null;          // reconocedor
let activo = false;      // el usuario dejo la voz encendida
let pausado = false;     // pausa mientras la app habla (para no escucharse a si misma)
let pendiente = null;    // { accion, intentos }: accion que espera "si" o "no"
let tPend = null;
let vigia = null;        // revisa cuando la app termino de hablar para volver a escuchar
let ultimoDicho = '';    // para el comando "repite"

// ---------- Utilidades de texto ----------
// minusculas, sin acentos ni signos: "¡Libera el lugar Cinco!" -> "libera el lugar cinco"
const limpiar = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[.,;:!?¡¿"']/g, ' ').replace(/\s+/g, ' ').trim();

const titulo = s => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
const cap = s => s === s.toLowerCase() ? titulo(s) : s;     // respeta lo que ya viene con mayusculas

const UNI = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
const DEC = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };

// "25", "veinticinco" o "treinta y cinco" -> numero (null si no se entiende)
function aNumero(t) {
  t = limpiar(t);
  if (/^\d+$/.test(t)) return Number(t);
  let suma = 0, ok = false;
  for (const w of t.split(' ')) {
    if (w === 'y') continue;
    if (w in UNI) suma += UNI[w];
    else if (w in DEC) suma += DEC[w];
    else if (w === 'cien' || w === 'ciento') suma += 100;
    else return null;
    ok = true;
  }
  return ok ? suma : null;
}

// Nombres de letras que a veces devuelve el reconocedor al deletrear una placa
const LETRAS = { a: 'A', be: 'B', ce: 'C', de: 'D', e: 'E', efe: 'F', ge: 'G', hache: 'H', i: 'I', jota: 'J', ka: 'K',
  ele: 'L', eme: 'M', ene: 'N', o: 'O', pe: 'P', cu: 'Q', erre: 'R', ese: 'S', te: 'T', u: 'U', uve: 'V', ve: 'V',
  equis: 'X', ye: 'Y', zeta: 'Z' };

// "a be ce uno dos tres" / "ABC 123" -> "ABC123"
const placaDe = s => norm(limpiar(s).split(' ').map(w => LETRAS[w] ?? (w in UNI && UNI[w] < 10 ? UNI[w] : w)).join(''));
const telefonoDe = s => limpiar(s).split(' ').map(w => (w in UNI && UNI[w] < 10) ? UNI[w] : w).join('').replace(/\D/g, '');
// Lista hablada: "1, 4 y 7"
const listaDe = nums => nums.length > 1 ? nums.slice(0, -1).join(', ') + ' ' + t('u.y') + ' ' + nums[nums.length - 1] : String(nums[0]);

// ---------- Mensajes ----------
const dice = m => { if (txt) txt.textContent = m; };
const aviso = m => { toast(m); dice(m); };

// Pausa el microfono, habla y vuelve a escuchar cuando termina
function decir(texto) {
  ultimoDicho = texto;
  pausar();
  hablar(texto);
}
// Respuesta a una pregunta: se ve y se oye (aunque el narrador este apagado, porque la pediste)
const responder = m => { aviso(m); decir(m); };

// ---------- Pausa mientras la app habla ----------
// Antes se esperaba el evento "callo" (fin de la voz). Chrome a veces no lo manda, o lo manda
// cuando todavia dice que esta hablando; entonces el microfono ya no se reactivaba y la
// confirmacion "si / no" solo funcionaba una vez. Ahora se revisa cada 150 ms si la voz ya termino.
function pausar() {
  if (!activo) return;
  pausado = true;
  if (rec) { try { rec.stop(); } catch (e) { /* nada */ } }
  vigilar();
}

function vigilar() {
  clearInterval(vigia);
  const inicio = Date.now();
  let silencio = 0;
  vigia = setInterval(() => {
    if (!activo) { clearInterval(vigia); vigia = null; return; }
    const habla = speechSynthesis.speaking || speechSynthesis.pending;
    // Si la voz se queda "colgada" (pasa en Chrome con frases largas) se corta a los 25 s
    if (habla && Date.now() - inicio > 25000) speechSynthesis.cancel();
    if (habla) { silencio = 0; return; }
    if (++silencio < 2) return;                    // unos 300 ms de silencio real
    clearInterval(vigia); vigia = null;
    reanudar();
  }, 150);
}

function reanudar() {
  pausado = false;
  arrancar();
  if (pendiente) {
    // El tiempo para responder empieza cuando la app termino de preguntar
    clearTimeout(tPend);
    tPend = setTimeout(() => { pendiente = null; aviso(t('voz.confirmaExp')); }, 10000);
    dice(t('voz.siono'));
  }
}

// ---------- Confirmacion por voz (acciones que no se pueden deshacer) ----------
const SI = /\b(si|sip|claro|correcto|afirmativo|dale|va|ok|okay|okey|de acuerdo|hazlo|confirmo|confirmar|confirmado|adelante|yes|oui|sim)\b/;
const NO = /\b(no|nel|nop|negativo|cancela|cancelar|cancelalo|mejor no|alto|detente|espera|no no)\b/;

function pedirConfirmacion(pregunta, accion) {
  pendiente = { accion, intentos: 0 };
  clearTimeout(tPend);
  toast(pregunta);
  decir(pregunta + ' ' + t('voz.siono'));
}
const limpiarPendiente = () => { pendiente = null; clearTimeout(tPend); };

// ---------- Acciones ----------
const lugarSel = () => state.lugares[String(state.sel)];
const click = sel => { const b = $(sel); if (b && !b.hidden && !b.disabled) { b.click(); return true; } return false; };
const visible = sel => { const b = $(sel); return !!b && !b.hidden; };
// La cabina de inspeccion escucha el teclado: la voz "presiona" las mismas teclas
const tecla = (key, extra = {}) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra }));
const lista = () => Object.values(state.lugares).sort((a, b) => a.numero - b.numero);

function elegirLugar(n) {
  if (!state.lugares[String(n)]) return aviso(t('voz.noExisteLugar', { n }));
  state.sel = n; state.lastKey = ''; panel();
  aviso(t('voz.lugar', { n }));
}

function necesitaOcupado() {
  const l = lugarSel();
  if (!l) { aviso(t('voz.primeroLugar')); return null; }
  if (l.estado !== 'ocupado') { aviso(t('voz.lugarLibre', { n: l.numero })); return null; }
  return l;
}

function liberar() {
  const l = necesitaOcupado(); if (!l) return;
  const n = l.numero, monto = total(l, l.hora_entrada.toMillis(), Date.now());
  pedirConfirmacion(t('voz.preguntaLiberar', { n, monto }), () => {
    if (state.sel !== n || !click('#lib')) aviso(t('voz.noLibero', { n }));
  });
}

function cancelarEntrada() {
  const l = necesitaOcupado(); if (!l) return;
  const n = l.numero;
  pedirConfirmacion(t('voz.preguntaCancelar', { n }), () => {
    if (state.sel !== n) return aviso(t('voz.noCancelo'));
    cancelar(lugarSel(), $('#cnc'), true);
  });
}

function boletoPerdido(quitar) {
  const l = necesitaOcupado(); if (!l) return;
  if (!!l.boleto_perdido === !quitar) return aviso(t(quitar ? 'voz.sinCargo' : 'voz.yaCargo'));
  click('#perd');
}

function cambiarTarifa(valor) {
  const tar = aNumero(valor);
  if (tar === null || tar < 0 || tar > 1000) return aviso(t('voz.noTarifa'));
  pedirConfirmacion(t('voz.preguntaTarifa', { t: tar }), () => {
    $('#tarifa').value = tar;
    $('#tarifa').onchange();         // guarda la tarifa y el narrador la anuncia
    toast(t('voz.tarifaOk', { t: tar }));
  });
}

// Llena un campo del formulario de entrada
function llenarCampo(campo, valor) {
  const f = $('#f');
  if (!f) return aviso(t('voz.elijeDisp'));
  if (campo === 'placa') f.elements.placa.value = placaDe(valor).slice(0, 10);
  else if (campo === 'modelo') f.elements.modelo.value = cap(valor);
  else if (campo === 'nombre') f.elements.nombre.value = cap(valor);
  else if (campo === 'tel') f.elements.tel.value = telefonoDe(valor);
  else if (campo === 'color') {
    const op = [...f.elements.color.options].find(o => limpiar(o.value) === limpiar(valor));
    if (!op) return aviso(t('voz.noColor', { c: valor }));
    f.elements.color.value = op.value;
  }
  const mostrado = campo === 'color' ? nombreColor(f.elements.color.value) : f.elements[campo].value;
  aviso(t('voz.listo', { campo: t('p.' + campo), valor: mostrado }));
}

function registrarEntrada() {
  const f = $('#f');
  if (!f) return aviso(t('voz.elijeDisp'));
  // requestSubmit con el boton, porque operaciones.entrada necesita saber que boton se pulso
  f.requestSubmit(f.querySelector('button:not([type])'));
}

function limpiarFormulario() {
  const f = $('#f');
  if (!f) return aviso(t('voz.elijeDisp'));
  ['placa', 'modelo', 'nombre', 'tel'].forEach(k => { f.elements[k].value = ''; });
  f.elements.color.selectedIndex = 0;
  aviso(t('voz.formLimpio'));
}

const cerrarDialogos = () => document.querySelectorAll('dialog[open]').forEach(d => d.close());

// ---------- Preguntas ----------
function lugaresLibres() {
  const libres = lista().filter(l => l.estado !== 'ocupado').map(l => l.numero);
  responder(libres.length ? tp('voz.libres', libres.length, { lista: listaDe(libres) }) : t('voz.ningunLibre'));
}
function lugaresOcupados() {
  const ocu = lista().filter(l => l.estado === 'ocupado').map(l => l.numero);
  responder(ocu.length ? tp('voz.ocupados', ocu.length, { lista: listaDe(ocu) }) : t('voz.ningunOcupado'));
}
function primerLibre() {
  const l = lista().find(x => x.estado !== 'ocupado');
  if (!l) return responder(t('voz.ningunLibre'));
  state.sel = l.numero; state.lastKey = ''; panel();
  responder(t('voz.primerLibre', { n: l.numero }));
}
function dondeEsta(texto) {
  const p = placaDe(texto);
  const l = lista().find(x => x.estado === 'ocupado' && x.id_vehiculo_actual === p);
  if (!l) return responder(t('voz.placaNo', { p: p.split('').join(' ') }));
  state.sel = l.numero; state.lastKey = ''; panel();
  $('#q').value = p; $('#q').oninput({ target: $('#q') });     // se resalta en el mapa
  responder(t('voz.placaEn', { p: p.split('').join(' '), n: l.numero }));
}
function cuantoLleva() {
  const l = necesitaOcupado(); if (!l) return;
  const a = l.hora_entrada.toMillis(), n = Date.now();
  responder(t('voz.cuenta', { n: l.numero, tiempo: dur(n - a), monto: money(total(l, a, n)) }));
}

function filtrarHistorial(valor) {
  const num = aNumero(valor);
  const x = num !== null && num <= 999 ? String(num) : placaDe(valor);
  $('#fq').value = x; $('#fq').oninput({ target: $('#fq') });
  aviso(t('voz.filtro', { x }));
}

const IDIOMA = { espanol: 'es', castellano: 'es', ingles: 'en', frances: 'fr', portugues: 'pt' };

function narrador(encender) {
  if (narradorOn() !== encender) $('#btnNarrador').click();
  responder(t(encender ? 'voz.narrOn' : 'voz.narrOff'));
}

// ---------- Cabina de inspeccion ----------
const TIPOS_VOZ = [
  [/\b(rayon|rayones|rayado|raya|rayadura)\b/, '1', 'td.rayon'],
  [/\b(abolladura|abollado|abollon|sumido|sumidura)\b/, '2', 'td.abolladura'],
  [/\b(golpe|golpeado|choque|chocado|impacto)\b/, '3', 'td.golpe'],
  [/\b(vidrio|cristal|parabrisas|ventana) ?(roto|estrellado)?\b/, '4', 'td.vidrio'],
  [/\b(pieza faltante|faltante|falta(?: una)? pieza|pieza)\b/, '5', 'td.faltante']
];
const VISTAS_VOZ = [
  [/\b(frente|frontal|delantera|de frente)\b/, 0, 'v.frente'],
  [/\b(lado )?izquierdo\b/, 1, 'v.izq'],
  [/\b(atras|trasera|parte trasera|cajuela)\b/, 2, 'v.atras'],
  [/\b(lado )?derecho\b/, 3, 'v.der']
];

// Devuelve true si el comando era de la cabina
function comandoCabina(n) {
  const marcando = visible('#btnRepetir'), capturando = visible('#btnSnap'), resumen = visible('#cabGuardar');
  let m;

  if (/\b(?:guardar|guarda|terminar|termina)\b.*\binspeccion\b|^(?:guardar|guarda|listo|terminar|termina)$/.test(n) && resumen) {
    click('#cabGuardar'); return true;
  }
  if ((m = n.match(/^(?:vista|ir a|ve a|ve al|pasar a|pasa a|cambiar a)(?: la| el)?(?: vista)? (.+)$/))) {
    const v = VISTAS_VOZ.find(([re]) => re.test(m[1]));
    if (v) { const b = document.querySelector(`#cabPasos [data-i="${v[1]}"]`); if (b) b.click(); aviso(t('voz.cabVista', { vista: t(v[2]) })); return true; }
  }
  if (/^(?:siguiente|siguiente vista|sin danos|no hay danos|no tiene danos|listo|lista|continuar|continua|ya quedo|ya esta)$/.test(n)) {
    if (marcando) tecla('Enter');
    else if (capturando) aviso(t('voz.cabSoloMarcar'));
    return true;
  }
  if (/^(?:deshacer|deshaz|regresa|quita lo ultimo|borra lo ultimo)$/.test(n)) { tecla('z', { ctrlKey: true }); return true; }
  if (/\b(?:borrar|borra|eliminar|elimina|quitar|quita)\b.*\bmarca\b/.test(n)) { tecla('Delete'); return true; }
  if (/\b(?:cambiar|cambia|otra) mano\b|\bsoy (?:zurdo|zurda|diestro|diestra)\b/.test(n)) { click('#cabZurdo'); aviso(t('voz.manoOk')); return true; }
  if (/^(?:salir|cerrar|cierra)(?: la)?(?: inspeccion| camara| ventana)?$/.test(n)) { cerrarDialogos(); return true; }
  // Tipo de dano: "rayon", "tipo golpe", "marcar abolladura"
  if (marcando && /^(?:(?:tipo|dano|marcar|marca|es un|es una|un|una) )?[a-z ]{3,30}$/.test(n)) {
    const tp2 = TIPOS_VOZ.find(([re]) => re.test(n));
    if (tp2) { tecla(tp2[1]); aviso(t('voz.cabTipo', { tipo: t(tp2[2]) })); return true; }
  }
  return false;
}

// ---------- Interpretacion ----------
function interpretar(orig) {
  const n = limpiar(orig).replace(/\b(por favor|porfa|gracias)\b/g, '').replace(/\s+/g, ' ').trim();
  if (!n) return;
  dice(t('voz.escuche', { x: orig }));

  // 1) Respuesta a una confirmacion pendiente
  if (pendiente) {
    const p = pendiente;
    if (NO.test(n)) { limpiarPendiente(); return aviso(t('voz.cancelado')); }
    if (SI.test(n)) { limpiarPendiente(); return p.accion(); }
    // No se entendio: se pregunta otra vez (una sola vez) en lugar de cancelar
    if (++p.intentos >= 2) { limpiarPendiente(); return aviso(t('voz.cancelado')); }
    clearTimeout(tPend);
    return decir(t('voz.siono2'));
  }

  // 2) Con la cabina de inspeccion abierta, primero sus comandos
  if ($('#dlgCabina') && $('#dlgCabina').open && comandoCabina(n)) return;

  // 3) Llenar el formulario: "placa ABC123", "nombre Juan Pérez", "color rojo"...
  const campo = orig.match(/^\s*(?:la |el |mi )?(placa|modelo|color|nombre|tel[eé]fono|celular)(?: del cliente| del veh[ií]culo)?\s*(?:es|:)?\s+(.+?)\s*$/i);
  if (campo && $('#f')) {
    const k = limpiar(campo[1]);
    return llenarCampo(k === 'telefono' || k === 'celular' ? 'tel' : k, campo[2]);
  }

  // 4) Comandos
  let m;
  if (/\b(ayuda|comandos|que puedo decir)\b/.test(n)) return $('#dlgVoz').showModal();
  if (/^(?:repite|repitelo|repetir|que dijiste|otra vez|no escuche)$/.test(n)) return ultimoDicho ? decir(ultimoDicho) : aviso(t('voz.nadaRepetir'));

  // Narrador (antes que "apagar voz", porque "apaga la voz del narrador" tambien dice "voz")
  if (/\b(?:activa|activar|enciende|encender|prende|prender)\b.*\bnarrador\b/.test(n)) return narrador(true);
  if (/\b(?:apaga|apagar|desactiva|desactivar|silencia|silenciar|quita|quitar)\b.*\bnarrador\b|^callate$/.test(n)) return narrador(false);
  if (/\b(apagar|apaga|desactivar|detener|parar)\b.*\b(voz|microfono|escucha|escuchar)\b|\bdeja de escuchar\b/.test(n)) return apagar();

  // Idioma: "idioma ingles", "cambia a frances", "pon la pagina en portugues"
  if ((m = n.match(/\b(?:idioma|lenguaje|cambia a|cambiar a|pon la pagina en|ponlo en|pasa a)\b.*\b(espanol|castellano|ingles|frances|portugues)\b/))) {
    setIdioma(IDIOMA[m[1]]);
    return responder(t('voz.idiomaOk'));
  }

  // Preguntas sobre el estacionamiento
  if (/\b(?:primer|primero|siguiente|algun|un)\b.*\b(?:lugar|cajon|espacio)\b.*\b(?:libre|disponible|vacio)\b|^dame un lugar$/.test(n)) return primerLibre();
  if (/\b(?:lugares|cajones|espacios)\b.*\b(?:libres|disponibles|vacios)\b|^(?:libres|disponibles|hay lugar|hay lugares)$/.test(n)) return lugaresLibres();
  if (/\b(?:lugares|cajones|espacios)\b.*\bocupados\b|^ocupados$/.test(n)) return lugaresOcupados();
  if ((m = n.match(/^(?:donde esta|en que lugar esta|en donde esta|ubica|localiza|encuentra)(?: el| la)?(?: auto| carro| coche| vehiculo| camioneta)?(?: con)?(?: la)?(?: placa)? (.+)$/))) return dondeEsta(m[1]);
  if (/\bcuanto (?:lleva|debe|va|es|le cobro|hay que cobrar|tiempo lleva)\b|\b(?:cuenta|total) (?:actual|a pagar)\b/.test(n)) return cuantoLleva();
  if (/\b(?:cuanto|que) (?:se )?(?:ha |hemos |llevamos |van )?(?:cobrado|ganado|ingresado|juntado)\b|\bingresos? (?:de )?hoy\b|\bcobrado hoy\b/.test(n)) {
    return responder(t('voz.hoy', { monto: $('#sIng').textContent }));
  }

  // Solo elegir lugar: "lugar 5", "abre el cajon cinco"
  if ((m = n.match(/^(?:abre |abrir |ve a |ir a |selecciona |seleccionar |elige |elegir |muestra |mostrar )?(?:el |al )?(?:lugar|cajon|espacio)(?: numero)? (.+)$/))) {
    const num = aNumero(m[1]);
    return num === null ? aviso(t('voz.noNumLugar')) : elegirLugar(num);
  }
  // Comandos con lugar incluido: "libera el lugar 5" -> primero elige el lugar
  if ((m = n.match(/\b(?:lugar|cajon|espacio)(?: numero)? (\d+|[a-z]+(?: y [a-z]+)?)/))) {
    const num = aNumero(m[1]);
    if (num !== null && state.lugares[String(num)] && state.sel !== num) { state.sel = num; state.lastKey = ''; panel(); }
  }
  if (/^(limpiar|borrar|quitar) (la )?busqueda$/.test(n)) { $('#q').value = ''; $('#q').oninput({ target: $('#q') }); return aviso(t('voz.busqLimpia')); }
  if ((m = n.match(/^(?:busca|buscar|buscame)(?: la)?(?: placa)? (.+)$/))) {
    $('#q').value = placaDe(m[1]); $('#q').oninput({ target: $('#q') });
    return aviso(t('voz.buscando', { x: $('#q').value }));
  }
  if ((m = n.match(/^(?:cambiar |cambia |poner |pon |fijar |fija )?(?:la )?tarifa(?: por hora)?(?: a| de| en)? (.+)$/))) return cambiarTarifa(m[1]);

  // Historial
  if (/^(?:limpiar|limpia|quitar|quita|borrar|borra)(?: el)? filtro(?: del historial)?$/.test(n)) {
    $('#fq').value = ''; $('#fq').oninput({ target: $('#fq') });
    return aviso(t('voz.filtroLimpio'));
  }
  if ((m = n.match(/^(?:filtra|filtrar|filtro)(?: el)?(?: historial)?(?: por)?(?: la placa| el lugar| placa| lugar)? (.+)$/))) return filtrarHistorial(m[1]);
  if (/\b(?:descargar|descarga|exportar|exporta|bajar|baja)\b.*\bexcel\b/.test(n)) return click('#btnExcel');

  if (/^(?:abrir|abre|ir a|ve a|ve al|llevame a|muestrame|mostrar)(?: los| el)? reportes?$/.test(n)) { location.href = 'reportes.html'; return; }

  // Inspeccion y camara
  if (/\b(?:ver|muestra|mostrar|ensena)\b.*\binspeccion\b/.test(n)) return click('#verIns') || aviso(t('voz.sinInspeccion'));
  if (/\b(?:abrir|abre|activa|activar|prende|prender|iniciar|inicia|empezar|empieza|hacer|haz)\b.*\b(?:camara|inspeccion)\b|^inspeccionar$/.test(n)) return click('#btnCam') || aviso(t('voz.elijeDisp2'));
  if (/\b(?:repetir|repite|otra)\b.*\bfoto\b/.test(n)) return click('#btnRepetir') || aviso(t('voz.sinFotoRep'));
  if (/\b(?:toma|tomar|saca|sacar|captura|capturar)\b.*\bfoto\b/.test(n)) return click('#btnSnap') || aviso(t('voz.abreCam'));
  if (/\b(?:limpiar|limpia|borrar|borra|vaciar|vacia)\b.*\bformulario\b/.test(n)) return limpiarFormulario();
  if (/\b(?:registrar|registra|guardar|guarda)\b.*\b(?:entrada|vehiculo|auto|carro)\b|^(?:registrar|guardar)$/.test(n)) return registrarEntrada();

  if (/\b(?:previsualizar|previsualiza|vista previa|preview)\b|\bver (?:el )?ticket\b/.test(n)) { if (necesitaOcupado()) click('#prev'); return; }
  if (/\b(?:quitar|quita|elimina|eliminar|sin)\b.*\bboleto perdido\b/.test(n)) return boletoPerdido(true);
  if (/\bboleto (?:perdido|extraviado)\b|\bperdio (?:el )?boleto\b/.test(n)) return boletoPerdido(false);
  if (/\bcancel(?:ar|a)\b.*\bentrada\b/.test(n)) return cancelarEntrada();
  if (/\b(?:liberar|libera|desocupar|desocupa|dar salida|da salida|registrar salida|cobrar|cobra)\b/.test(n)) return liberar();

  if (/\b(?:descargar|descarga|bajar|baja)\b.*\b(?:pdf|ticket)\b/.test(n)) return click('#tkPdf') || aviso(t('voz.sinTicket'));
  if (/\bimprim(?:ir|e)\b/.test(n)) return click('#tkImprimir') || aviso(t('voz.sinTicket'));
  if (/^(?:cerrar|cierra|salir)(?: el| la)?(?: ticket| ventana| ayuda| inspeccion)?$/.test(n)) return cerrarDialogos();

  aviso(t('voz.noEntendi'));
}

// ---------- Reconocimiento ----------
function crearReconocedor() {
  const r = new SR();
  r.lang = 'es-MX';       // los comandos se dicen en español aunque la pagina este en otro idioma
  r.continuous = true;
  r.interimResults = true;
  r.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i], frase = res[0].transcript.trim();
      if (!res.isFinal) { if (!pausado) dice('…' + frase); continue; }
      if (speechSynthesis.speaking || pausado) continue;     // lo que dijo la propia app se ignora
      interpretar(frase);
    }
  };
  r.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      aviso(t('voz.noPermiso'));
      apagar(true);
    } else if (e.error === 'network') {
      aviso(t('voz.noInternet'));
      apagar(true);
    }                                                          // no-speech / aborted: se reinicia solo
  };
  r.onend = () => { if (activo && !pausado) setTimeout(arrancar, 150); };
  return r;
}

function arrancar() {
  if (!activo || pausado) return;
  rec = rec || crearReconocedor();
  try { rec.start(); } catch (e) { /* ya estaba iniciado: onend lo vuelve a arrancar */ }
}

function pintarBoton() {
  btn.textContent = activo ? t('voz.escuchando') : t('voz.activar');
  btn.classList.toggle('voz-on', activo);
  btn.setAttribute('aria-pressed', String(activo));
}

function encender() {
  activo = true; pausado = false;
  pintarBoton();
  dice(t('voz.inicio'));
  arrancar();
}

function apagar(silencio) {
  activo = false; pausado = false;
  limpiarPendiente();
  clearInterval(vigia); vigia = null;
  if (rec) { try { rec.stop(); } catch (e) { /* nada */ } }
  pintarBoton();
  if (!silencio) dice(t('voz.apagada'));
}

// Cuando cualquier parte de la app habla (narrador, tickets...) se pausa el microfono
document.addEventListener('hablando', () => { if (activo) pausar(); });
document.addEventListener('callo', () => { if (activo && pausado && !vigia) vigilar(); });

if (!SR) {
  btn.disabled = true;
  btn.textContent = t('voz.noDisp');
  btn.title = t('voz.noDispTitle');
} else {
  btn.onclick = () => activo ? apagar() : encender();
}
$('#btnVozAyuda').onclick = () => $('#dlgVoz').showModal();
$('#vozCerrar').onclick = () => $('#dlgVoz').close();

// ---------- Ayuda: se agregan los comandos nuevos a la ventana "?" ----------
const AYUDA_EXTRA = [
  ['ay.inspeccion', '"iniciar inspección" · "tomar foto" · "repetir foto" · "vista atrás" · "siguiente" / "sin daños" · "guardar inspección" · "ver inspección"'],
  ['ay.danos', '"rayón" · "abolladura" · "golpe" · "vidrio roto" · "pieza faltante" · "deshacer" · "borrar marca" · "cambiar mano"'],
  ['ay.preguntas', '"¿qué lugares están libres?" · "primer lugar libre" · "¿dónde está la placa ABC123?" · "¿cuánto lleva?" · "¿cuánto se ha cobrado hoy?" · "repite"'],
  ['ay.historial', '"filtrar historial ABC123" · "filtrar lugar 5" · "limpiar filtro" · "descargar Excel"'],
  ['ay.preferencias', '"idioma inglés" · "activar narrador" · "apagar narrador" · "limpiar formulario"'],
  ['ay.respuestas', '"sí" · "claro" · "dale" · "no" · "cancela"']
];
const dlAyuda = document.querySelector('#dlgVoz dl');
if (dlAyuda) {
  AYUDA_EXTRA.forEach(([clave, cmds]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.dataset.i18n = clave; dt.textContent = t(clave);       // aplicar() lo traduce al cambiar de idioma
    dd.textContent = cmds;
    dlAyuda.append(dt, dd);
  });
}

// Al cambiar de idioma se actualizan los textos del boton de voz
document.addEventListener('idioma', () => {
  if (!SR) { btn.textContent = t('voz.noDisp'); btn.title = t('voz.noDispTitle'); return; }
  pintarBoton();
});

// ---------- Solo para pruebas desde la consola: __voz('lugares libres') ----------
window.__voz = interpretar;