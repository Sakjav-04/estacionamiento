// Operaciones de entrada y salida (RF-04, RF-05, RF-10)
import { db, C, doc, writeBatch, Timestamp } from './firebase.js';
import { state, PERDIDA } from './state.js';
import { norm, toast, money, total, narrar, durHablada } from './utils.js';
import { t } from './i18n.js';
import { getInspeccion, limpiarInspeccion } from './cabina.js';
import { abrirTicket } from './ticket.js';

// Muestra el aviso en pantalla y, si el narrador esta encendido, tambien lo dice en voz alta
const avisa = (txt, voz = txt) => { toast(txt); narrar(voz); };

export async function entrada(l, fd, btn) {
  const placa = norm(fd.get('placa'));
  if (!placa) return avisa(t('op.placaInvalida'));
  const ins = getInspeccion();              // 4 fotos con los daños marcados
  if (!ins) return avisa(t('ins.falta'));
  const dentro = Object.values(state.lugares).find(x => x.id_vehiculo_actual === placa);
  if (dentro) return avisa(t('op.yaDentro', { n: dentro.numero }));

  btn.disabled = true;
  const b = writeBatch(db), rid = doc(C.r), now = Timestamp.now();
  b.set(doc(C.c, placa), {
    id_vehiculo: placa, placa,
    modelo: fd.get('modelo').trim(), color: fd.get('color'),
    nombre_cliente: fd.get('nombre').trim(), telefono: fd.get('tel').trim(),
    foto: ins.fotos[0].img,                // foto del frente con sus marcas (texto base64)
    danos: ins.resumen, danos_total: ins.total
  });
  b.set(rid, { id_registro: rid.id, id_lugar: String(l.numero), id_vehiculo: placa, hora_entrada: now, hora_salida: null, monto_total: null, boleto_perdido: false,
    danos: ins.resumen, danos_total: ins.total });
  // Las 4 fotos van en su propio documento (mismo id que el registro) para no hacer pesada la lista de clientes
  b.set(doc(C.i, rid.id), { id_registro: rid.id, id_vehiculo: placa, fecha: now, fotos: ins.fotos, resumen: ins.resumen, total: ins.total });
  b.update(doc(C.l, String(l.numero)), { estado: 'ocupado', id_vehiculo_actual: placa, id_registro_actual: rid.id, hora_entrada: now, boleto_perdido: false });
  try {
    await b.commit();
    limpiarInspeccion();
    avisa(t('op.entradaOk', { n: l.numero }),
          t('op.entradaVoz', { placa: placa.split('').join(' '), n: l.numero, perdida: PERDIDA }));
  } catch (e) {
    avisa(t('op.noGuardo', { code: e.code }), t('op.noGuardoVoz'));
    btn.disabled = false;
  }
}

export async function salida(l, c, btn) {
  btn.disabled = true;
  const out = new Date(), monto = total(l, l.hora_entrada.toMillis(), out.getTime()), b = writeBatch(db);
  b.update(doc(C.r, l.id_registro_actual), { hora_salida: Timestamp.fromDate(out), monto_total: monto, boleto_perdido: !!l.boleto_perdido });
  b.update(doc(C.l, String(l.numero)), { estado: 'disponible', id_vehiculo_actual: null, id_registro_actual: null, hora_entrada: null, boleto_perdido: false });
  try {
    await b.commit();
    narrar(t('op.salidaVoz', { n: l.numero, placa: (c.placa || l.id_vehiculo_actual || '').split('').join(' '),
      tiempo: durHablada(out.getTime() - l.hora_entrada.toMillis()), monto }));
    abrirTicket({ l, c, salida: out, final: true });
  } catch (e) {
    avisa(t('op.noLibero', { code: e.code }), t('op.noLiberoVoz'));
    btn.disabled = false;
  }
}

// Marca o desmarca el cargo por boleto perdido del cajon
export async function perdido(l, btn) {
  btn.disabled = true;
  const nuevo = !l.boleto_perdido, b = writeBatch(db);
  b.update(doc(C.l, String(l.numero)), { boleto_perdido: nuevo });
  b.update(doc(C.r, l.id_registro_actual), { boleto_perdido: nuevo });
  try {
    await b.commit();
    if (nuevo) avisa(t('op.perdidoOn', { monto: money(PERDIDA) }), t('op.perdidoOnVoz', { n: l.numero, perdida: PERDIDA }));
    else avisa(t('op.perdidoOff'), t('op.perdidoOffVoz', { n: l.numero }));
  } catch (e) {
    avisa(t('op.noActualizo', { code: e.code }));
  }
  btn.disabled = false;
}

// Deshace una entrada capturada por error: borra el registro por completo
export async function cancelar(l, btn, yaConfirmado = false) {
  if (!yaConfirmado && !confirm(t('op.confirmCancelar', { n: l.numero }))) return;
  btn.disabled = true;
  const b = writeBatch(db);
  b.delete(doc(C.r, l.id_registro_actual));
  b.delete(doc(C.i, l.id_registro_actual));   // y sus fotos de inspeccion
  b.update(doc(C.l, String(l.numero)), { estado: 'disponible', id_vehiculo_actual: null, id_registro_actual: null, hora_entrada: null, boleto_perdido: false });
  try {
    await b.commit();
    avisa(t('op.canceladaOk'), t('op.canceladaVoz', { n: l.numero }));
  } catch (e) {
    avisa(t('op.noCancelo', { code: e.code }));
    btn.disabled = false;
  }
}