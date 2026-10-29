// Conexion a Firebase. Solo este archivo conoce la URL del SDK.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, onSnapshot, getDoc, getDocs, writeBatch, query, where, orderBy, limit, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { $ } from './utils.js';

// ====== CONFIGURACION DE TU PROYECTO FIREBASE ======
const firebaseConfig = {
  apiKey: "AIzaSyBYv68XHZf2JH065ukVSN4DqPkCHjtU13Y",
  authDomain: "estacionamiento-61138.firebaseapp.com",
  projectId: "estacionamiento-61138",
  storageBucket: "estacionamiento-61138.firebasestorage.app",
  messagingSenderId: "668417771599",
  appId: "1:668417771599:web:3158929c49da455be7023a"
};
// ===================================================

// Si la llave empieza con "TU_" es que no se ha configurado
if (firebaseConfig.apiKey.startsWith("TU_")) {
  $('#setup').hidden = false;
  throw new Error("Firebase sin configurar");
}

// Conexion a la base de datos
export const db = getFirestore(initializeApp(firebaseConfig));

// Atajos a las colecciones que usa el sistema (inspecciones = las 4 fotos con daños de cada entrada)
export const C = {
  l: collection(db, 'lugares'),
  c: collection(db, 'clientes_vehiculos'),
  r: collection(db, 'registros_movimientos'),
  i: collection(db, 'inspecciones')
};

// Re-exporta lo que usan los demas modulos para no repetir la URL del SDK
export { doc, onSnapshot, getDoc, getDocs, writeBatch, query, where, orderBy, limit, Timestamp };