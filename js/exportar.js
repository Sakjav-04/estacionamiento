// Descarga el historial de movimientos en un archivo de Excel (.xlsx).
// Usa SheetJS (la libreria XLSX, cargada en index.html antes de main.js).
// Exporta TODOS los movimientos guardados (no solo los 40 que se ven en la tabla).
// Si hay algo escrito en el filtro del historial, exporta solo lo que coincide.
import { C, getDocs, query, orderBy } from './firebase.js';
import { filtrarHistorial } from './listeners.js';
import { toast, narrar } from './utils.js';
import { t } from './i18n.js';

const avisa = txt => { toast(txt); narrar(txt); };

export async function exportarExcel(btn) {
  if (typeof XLSX === 'undefined') return avisa(t('h.excelError'));   // no cargo la libreria
  btn.disabled = true;
  try {
    const snap = await getDocs(query(C.r, orderBy('hora_entrada', 'desc')));
    const todos = [];
    snap.forEach(d => todos.push(d.data()));
    const rows = filtrarHistorial(todos);
    if (!rows.length) return avisa(t('h.excelVacio'));

    const aFecha = ts => (ts ? ts.toDate() : null);
    const encabezado = [t('th.lugar'), t('th.placa'), t('th.entrada'), t('th.salida'), t('th.perdido'), t('th.monto')];
    const filas = rows.map(r => [
      Number(r.id_lugar) || r.id_lugar,
      r.id_vehiculo,
      aFecha(r.hora_entrada),
      r.hora_salida ? aFecha(r.hora_salida) : t('h.enCurso'),
      r.boleto_perdido ? t('h.si') : t('h.no'),
      r.hora_salida ? Number(r.monto_total || 0) : null
    ]);

    const ws = XLSX.utils.aoa_to_sheet([encabezado, ...filas], { cellDates: true });

    // Formato de fechas y de dinero
    for (let i = 1; i <= filas.length; i++) {
      for (const col of ['C', 'D']) {
        const c = ws[col + (i + 1)];
        if (c && c.t === 'd') c.z = 'dd/mm/yyyy hh:mm';
      }
      const m = ws['F' + (i + 1)];
      if (m && m.t === 'n') m.z = '"$"#,##0.00';
    }
    ws['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 12 }];
    ws['!autofilter'] = { ref: `A1:F${filas.length + 1}` };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t('h.hoja'));
    const hoy = new Date().toLocaleDateString('sv-SE');               // AAAA-MM-DD en hora local
    XLSX.writeFile(wb, `historial_movimientos_${hoy}.xlsx`, { cellDates: true });
    avisa(t('h.excelOk'));
  } catch (e) {
    console.error(e);
    avisa(t('h.excelError'));
  } finally {
    btn.disabled = false;
  }
}
