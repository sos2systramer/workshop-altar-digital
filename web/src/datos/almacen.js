// Donde se guarda el altar: en tu propia API (Lambda + DynamoDB + S3).
//
// Las cuatro funciones (listar, agregar, borrar, urlDeImagen) mantienen la
// firma que tenian con localStorage, asi que ningun componente cambia.

import { setTradicional } from '../catalogo/elementos.js'
import { reducirABlob } from '../lib/imagen.js'

// Este archivo guarda en la nube; el banner de la pagina lo muestra tal cual.
export const MODO = 'nube'

// La URL de la API viene de la variable de entorno, sin diagonal final.
const API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

// La URL de la pagina identifica el altar: laptop y telefono ven el mismo.
const altarId = window.location.hostname

const LLAVE = 'ofrenda:elementos'
const LLAVE_IMPORTADO = 'ofrenda:importado'
const LLAVE_NOMBRE = 'ofrenda:nombre'

/** Llama a la API y devuelve el JSON, o lanza un Error con un mensaje claro. */
async function pedir(ruta, opciones) {
  if (!API) throw new Error('Falta VITE_API_URL: la pagina no sabe donde esta tu API.')
  const resp = await fetch(`${API}${ruta}`, opciones)
  const datos = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(datos.error || `La API respondio ${resp.status}.`)
  return datos
}

const postJson = (ruta, cuerpo) =>
  pedir(ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })

/** Sube un Blob a S3 con una URL firmada y devuelve su imageKey. */
async function subirImagen(blob) {
  const { url, imageKey } = await postJson('/uploads', { altarId, contentType: blob.type })
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type },
    body: blob,
  })
  if (!resp.ok) throw new Error('No pude subir la imagen.')
  return imageKey
}

/** Convierte una data URL (la imagen del localStorage) en un Blob. */
async function dataUrlABlob(dataUrl) {
  return (await fetch(dataUrl)).blob()
}

/** Los elementos que el altar tenia en este navegador (o el set tradicional). */
function elementosLocales() {
  try {
    const crudo = localStorage.getItem(LLAVE)
    if (crudo === null) return setTradicional()
    const lista = JSON.parse(crudo)
    return Array.isArray(lista) ? lista : []
  } catch {
    return []
  }
}

/**
 * Primera carga: si la API esta vacia, sube lo que habia en localStorage,
 * incluidas las imagenes. Se hace una sola vez por navegador.
 */
async function importarLocales() {
  for (const viejo of elementosLocales()) {
    const { imagenLocal, id, creadoEn, imageKey, ...campos } = viejo
    const nuevo = { altarId, ...campos }
    if (imagenLocal) nuevo.imageKey = await subirImagen(await dataUrlABlob(imagenLocal))
    else if (imageKey) nuevo.imageKey = imageKey
    // En serie, para que conserven el orden en que estaban.
    await postJson('/elements', nuevo)
  }
  localStorage.setItem(LLAVE_IMPORTADO, '1')
}

async function leerDeLaApi() {
  const { elementos } = await pedir(`/elements?altarId=${encodeURIComponent(altarId)}`)
  return elementos
}

/** Todos los elementos del altar, ordenados por cuando se pusieron. */
export async function listar() {
  let elementos = await leerDeLaApi()
  if (elementos.length === 0 && !localStorage.getItem(LLAVE_IMPORTADO)) {
    await importarLocales()
    elementos = await leerDeLaApi()
  }
  return elementos.sort((a, b) => a.creadoEn.localeCompare(b.creadoEn))
}

/**
 * Agrega un elemento y devuelve como quedo guardado.
 * Si trae `imagen` (el File del formulario), se reduce y se sube a S3;
 * en el elemento solo se guarda su `imageKey`.
 */
export async function agregar(elemento) {
  const { imagen, ...resto } = elemento
  const cuerpo = { ...resto, altarId }
  if (imagen) cuerpo.imageKey = await subirImagen(await reducirABlob(imagen))
  return postJson('/elements', cuerpo)
}

/** Quita un elemento del altar. */
export async function borrar(id) {
  await postJson('/elements', { altarId, borrar: true, id })
}

// URLs firmadas ya pedidas, para no pedir la misma imagen dos veces.
const urlsFirmadas = new Map()

/** De donde sale la imagen de un elemento: una URL firmada de S3. */
export async function urlDeImagen(elemento) {
  const llave = elemento.imageKey
  if (!llave) return null
  if (!urlsFirmadas.has(llave)) {
    // El "/" de la llave se queda: la ruta {proxy+} lo recibe completo.
    const ruta = llave.split('/').map(encodeURIComponent).join('/')
    urlsFirmadas.set(llave, pedir(`/uploads/${ruta}`).then((r) => r.url))
  }
  try {
    return await urlsFirmadas.get(llave)
  } catch {
    urlsFirmadas.delete(llave)
    return null
  }
}

/** Quien esta poniendo cosas en el altar. Se pregunta una sola vez. */
export function nombre() {
  return localStorage.getItem(LLAVE_NOMBRE) || ''
}

export function guardarNombre(valor) {
  localStorage.setItem(LLAVE_NOMBRE, valor.slice(0, 40))
}
