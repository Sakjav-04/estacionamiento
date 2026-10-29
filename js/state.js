// Estado compartido. Se usa un objeto porque un módulo no puede reasignar
// un `let` exportado por otro módulo.
export const state = {
  lugares: {},
  clientes: {},
  sel: null,
  lastKey: '',
  busca: '',
  seeded: false,
  hist: [],      // ultimos movimientos del historial (para el filtro)
  filtro: ''     // texto escrito en el filtro del historial
};

// Dimensiones de cada cajón en el canvas
export const W = 80, H = 130;

// Cargo fijo por perdida de boleto (en pesos)
export const PERDIDA = 50;

export const COLORES = {
  Blanco: '#f1f5f9', Negro: '#0f172a', Gris: '#94a3b8', Plata: '#cbd5e1', Rojo: '#b91c1c',
  Azul: '#2563eb', Verde: '#15803d', Amarillo: '#eab308', Naranja: '#ea580c', Café: '#78350f'
};
