// Funciones auxiliares sin dependencias de Firebase.
import { PERDIDA } from './state.js';
import { t, tp, locale, idioma } from './i18n.js';

export const $ = s => document.querySelector(s);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

export const norm = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

export const fmt = d => d
  ? d.toDate().toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '—';

// Los pesos siempre se escriben al estilo mexicano ($1,234.50), en cualquier idioma
export const money = n => '$' + Number(n || 0).toLocaleString('es-MX', {
  minimumFractionDigits: 0, maximumFractionDigits: 2
});

export const toast = m => {
  const t = $('#toast');
  t.textContent = m;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
};

export const tarifaHora = () => Math.max(0, Number($('#tarifa').value) || 0);

// RF-07: cada hora iniciada se cobra completa, mínimo 1 hora
export const horas = (a, b) => Math.max(1, Math.ceil((b - a) / 3600000));
export const calc = (a, b) => horas(a, b) * tarifaHora();

// Cargo extra si el cajon tiene marcado "boleto perdido"
export const cargoPerdido = l => (l && l.boleto_perdido) ? PERDIDA : 0;

// Total a cobrar = horas x tarifa + cargo por boleto perdido
export const total = (l, a, b) => calc(a, b) + cargoPerdido(l);

export const dur = ms => {
  const m = Math.floor(ms / 60000);
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
};

// Duracion dicha en palabras para la voz: "2 horas y 25 minutos"
export const durHablada = ms => {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), mm = m % 60;
  if (!h) return tp('u.minuto', mm);
  return mm ? `${tp('u.hora', h)} ${t('u.y')} ${tp('u.minuto', mm)}` : tp('u.hora', h);
};

// Voz nativa del navegador (Web Speech API). No necesita librerias.
// Habla en el idioma elegido en la pagina.
export const hablar = texto => {
  if (!('speechSynthesis' in window)) return;      // navegador sin voz
  speechSynthesis.cancel();                        // corta lo que estuviera hablando
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = locale();
  u.rate = 0.95;
  // Si hay una voz instalada del idioma, se prefiere la de la region exacta (ej. es-MX)
  const voces = speechSynthesis.getVoices();
  const igual = v => v.lang.replace('_', '-');
  const voz = voces.find(v => igual(v) === locale()) || voces.find(v => igual(v).startsWith(idioma()));
  if (voz) u.voice = voz;
  // Avisos para voz.js: mientras la app habla, el microfono se pausa para no escucharse a si misma
  u.onstart = () => document.dispatchEvent(new Event('hablando'));
  u.onend = u.onerror = () => document.dispatchEvent(new Event('callo'));
  speechSynthesis.speak(u);
};

// Narrador: cuenta en voz alta lo que pasa (entrada, salida, errores...). Se puede apagar.
export const narradorOn = () => { try { return localStorage.getItem('narrar') !== '0'; } catch (e) { return true; } };
export const setNarrador = on => {
  try { localStorage.setItem('narrar', on ? '1' : '0'); } catch (e) { /* nada */ }
  if (!on && 'speechSynthesis' in window) speechSynthesis.cancel();
};
export const narrar = texto => { if (narradorOn()) hablar(texto); };
