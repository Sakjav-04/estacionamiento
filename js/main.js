// Punto de entrada: carga los módulos y conecta los controles del encabezado.
import './firebase.js';
import { pintarHistorial, pintarSync } from './listeners.js';
import { buscar } from './canvas.js';
import { panel, tick } from './panel.js';
import { state } from './state.js';
import { $, norm, narrar, narradorOn, setNarrador } from './utils.js';
import { t, aplicar, setIdioma, idioma } from './i18n.js';
import './voz.js';          // instrucciones por voz
import { exportarExcel } from './exportar.js';

// ---------- Idioma ----------
aplicar();                    // pone los textos fijos en el idioma guardado

// Al cambiar de idioma se vuelve a pintar todo lo que se genera con codigo
document.addEventListener('idioma', () => {
  state.lastKey = ''; panel();   // panel lateral
  pintarHistorial();             // tabla del historial
  buscar();                      // pista de la busqueda
  pintarSync();                  // texto de conexion
  pintarNarrador();
  $('#selIdioma').value = idioma();
});

// Selector del encabezado
$('#selIdioma').value = idioma();
$('#selIdioma').onchange = e => setIdioma(e.target.value);

// Ventana de bienvenida: se muestra una vez por sesion (al abrir la pagina en una pestana nueva)
const dlgBienvenida = $('#dlgBienvenida');
dlgBienvenida.addEventListener('cancel', e => e.preventDefault());       // hay que elegir un idioma
dlgBienvenida.querySelectorAll('[data-idioma]').forEach(b => {
  b.classList.toggle('actual', b.dataset.idioma === idioma());
  b.onclick = () => {
    setIdioma(b.dataset.idioma);
    try { sessionStorage.setItem('bienvenida', '1'); } catch (e) { /* nada */ }
    dlgBienvenida.close();
    narrar(t('bv.hablada'));      // la voz saluda en el idioma elegido (el clic permite que el navegador hable)
  };
});
let vista = false;
try { vista = sessionStorage.getItem('bienvenida') === '1'; } catch (e) { /* nada */ }
if (!vista) dlgBienvenida.showModal();

// ---------- Narrador (voz que cuenta lo que pasa) ----------
function pintarNarrador() {
  const on = narradorOn();
  $('#btnNarrador').textContent = t(on ? 'narr.on' : 'narr.off');
  $('#btnNarrador').setAttribute('aria-pressed', String(on));
  $('#btnNarrador').classList.toggle('voz-on', on);
}
$('#btnNarrador').onclick = () => { setNarrador(!narradorOn()); pintarNarrador(); };
pintarNarrador();

// ---------- Tarifa por hora (se recuerda en el navegador) ----------
$('#tarifa').value = localStorage.getItem('tarifa') || 20;
$('#tarifa').onchange = () => {
  localStorage.setItem('tarifa', $('#tarifa').value);
  tick();
  narrar(t('op.tarifaVoz', { t: Number($('#tarifa').value) || 0 }));
};
setInterval(tick, 1000);

// Búsqueda por placa
$('#q').oninput = e => { state.busca = norm(e.target.value); buscar(); };

// Filtro del historial (por placa o por numero de lugar)
$('#fq').oninput = e => { state.filtro = e.target.value; pintarHistorial(); };

// Descargar el historial en Excel
$('#btnExcel').onclick = e => exportarExcel(e.currentTarget);

// Cerrar el dialogo del ticket
$('#dlgOk').onclick = () => $('#dlg').close();
