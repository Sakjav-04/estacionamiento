// Motor de idiomas. El idioma elegido se recuerda en el navegador (localStorage) y lo usan
// tanto el mapa (index.html) como los reportes (reportes.html).
// Uso en JS:    t('clave'), t('clave', { n: 5 }), tp('clave', cantidad)
// Uso en HTML:  data-i18n="clave" (texto), data-i18n-html (con etiquetas), data-i18n-ph (placeholder),
//               data-i18n-title (tooltip), data-i18n-aria (aria-label), data-i18n-alt (alt de imagen)
import { DICC } from './idiomas.js';
import { DICC_CABINA } from './idiomas-cabina.js';   // textos de la cabina de inspeccion
import { DICC_VOZ } from './idiomas-voz.js';           // textos de los comandos de voz nuevos

// locale = formato de fechas y tambien el idioma de la voz que habla
export const IDIOMAS = {
  es: { nombre: 'Español',   locale: 'es-MX' },
  en: { nombre: 'English',   locale: 'en-US' },
  fr: { nombre: 'Français',  locale: 'fr-FR' },
  pt: { nombre: 'Português', locale: 'pt-BR' }
};

const leer = () => { try { return localStorage.getItem('idioma'); } catch (e) { return null; } };
let actual = leer() in IDIOMAS ? leer() : 'es';

export const idioma = () => actual;
export const locale = () => IDIOMAS[actual].locale;

// Diccionarios en orden de busqueda: idiomas.js, idiomas-cabina.js e idiomas-voz.js
const DICCS = [DICC, DICC_CABINA, DICC_VOZ];
const buscar = (cod, clave) => { for (const d of DICCS) { const v = d[cod]?.[clave]; if (v !== undefined) return v; } };

// Traduce una clave. Si falta en el idioma actual usa el español; si tampoco existe, devuelve la clave.
export function t(clave, vars) {
  let s = buscar(actual, clave) ?? buscar('es', clave) ?? clave;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

// Singular / plural segun la cantidad: tp('u.hora', 1) usa 'u.hora_1', y con otro numero 'u.hora_n'
export const tp = (clave, n, vars) => t(clave + (n === 1 ? '_1' : '_n'), { n, ...vars });

// Texto de un color (los valores guardados en la base de datos siguen siendo los de siempre)
export const nombreColor = c => t('color.' + c);

// Pone todos los textos marcados con data-i18n en el idioma actual
export function aplicar(raiz = document) {
  document.documentElement.lang = actual;
  raiz.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
  raiz.querySelectorAll('[data-i18n-html]').forEach(e => { e.innerHTML = t(e.dataset.i18nHtml); });
  const atributos = { 'i18n-ph': 'placeholder', 'i18n-title': 'title', 'i18n-aria': 'aria-label', 'i18n-alt': 'alt' };
  for (const [data, attr] of Object.entries(atributos)) {
    raiz.querySelectorAll(`[data-${data}]`).forEach(e => e.setAttribute(attr, t(e.getAttribute('data-' + data))));
  }
}

// Cambia el idioma, lo guarda y avisa al resto de la pagina con el evento "idioma"
export function setIdioma(cod) {
  if (!(cod in IDIOMAS)) return;
  actual = cod;
  try { localStorage.setItem('idioma', cod); } catch (e) { /* sin almacenamiento: solo dura esta visita */ }
  aplicar();
  document.dispatchEvent(new Event('idioma'));
}