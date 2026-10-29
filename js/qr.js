// Codigo QR del ticket. Usa la libreria qrcode-generator (variable global `qrcode`,
// se carga en index.html antes de main.js). El QR se dibuja con vectores (cuadritos),
// asi que se ve nitido en pantalla, al imprimir y dentro del PDF, sin convertir imagenes.

// Deja el texto en ASCII para que cualquier lector de QR lo muestre igual
const aAscii = s => String(s)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // quita acentos
  .replace(/[\u00A0\u2000-\u206F]/g, ' ')            // espacios raros -> espacio normal
  .replace(/\u00B0/g, 'o')                          // N° -> No
  .replace(/[^\x20-\x7E\n]/g, '-');                   // cualquier otro simbolo -> guion

// Devuelve el QR listo para dibujar, o null si la libreria no cargo (sin internet)
export function crearQR(texto) {
  if (typeof qrcode === 'undefined') return null;
  try {
    const qr = qrcode(0, 'M');        // 0 = el tamano se ajusta solo; M = correccion de errores media
    qr.addData(aAscii(texto), 'Byte');
    qr.make();
    return qr;
  } catch (e) {
    return null;
  }
}

// Recorre el QR por tramos oscuros continuos de cada fila (menos figuras que cuadrito por cuadrito)
function tramos(qr, fn) {
  const n = qr.getModuleCount();
  for (let f = 0; f < n; f++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(f, c)) { c++; continue; }
      const ini = c;
      while (c < n && qr.isDark(f, c)) c++;
      fn(f, ini, c - ini);
    }
  }
}

// QR como SVG para mostrarlo en el ticket de pantalla
export function qrSvg(qr, margen = 2) {
  const n = qr.getModuleCount(), total = n + margen * 2;
  let d = '';
  tramos(qr, (f, c, largo) => { d += `M${c + margen} ${f + margen}h${largo}v1h-${largo}z`; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="Codigo QR del ticket"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// Dibuja el QR dentro de un PDF de jsPDF. (x, y) es la esquina superior izquierda y
// `tam` el lado total en mm. No incluye margen blanco: dejalo libre alrededor.
export function qrEnPdf(doc, qr, x, y, tam) {
  const cel = tam / qr.getModuleCount();
  doc.setFillColor(0, 0, 0);
  // +0.03 mm de alto para que no queden lineas finas entre filas en algunos visores
  tramos(qr, (f, c, largo) => doc.rect(x + c * cel, y + f * cel, largo * cel, cel + 0.03, 'F'));
}
