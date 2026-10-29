// POST /elements
//   crear:  { altarId, tipo, nivel, texto, link, puestoPor, imageKey }  -> 201 elemento
//   borrar: { altarId, borrar: true, id }                              -> 200 { borrado }
import { randomUUID } from 'node:crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
}

const responder = (statusCode, cuerpo) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(cuerpo),
})

// Solo estos campos se aceptan del cliente; lo demás se ignora.
const CAMPOS_PERMITIDOS = ['tipo', 'nivel', 'texto', 'link', 'puestoPor', 'imageKey']

async function borrar(altarId, id) {
  const { Items = [] } = await db.send(
    new QueryCommand({
      TableName: process.env.TABLA,
      KeyConditionExpression: 'altarId = :a',
      FilterExpression: 'id = :id',
      ExpressionAttributeValues: { ':a': altarId, ':id': id },
    }),
  )
  if (Items.length === 0) return responder(404, { error: 'No existe ese elemento en este altar.' })

  await db.send(
    new DeleteCommand({
      TableName: process.env.TABLA,
      Key: { altarId, sk: Items[0].sk },
    }),
  )
  return responder(200, { borrado: id })
}

async function crear(altarId, cuerpo) {
  if (!cuerpo.tipo) return responder(400, { error: 'Falta tipo.' })

  const item = {}
  for (const campo of CAMPOS_PERMITIDOS) {
    if (cuerpo[campo] !== undefined && cuerpo[campo] !== null && cuerpo[campo] !== '') {
      item[campo] = cuerpo[campo]
    }
  }
  if (typeof item.texto === 'string') item.texto = item.texto.slice(0, 280)
  if (typeof item.puestoPor === 'string') item.puestoPor = item.puestoPor.slice(0, 40)
  item.nivel = Number(item.nivel) || 1

  // La posición es cuántos elementos hay ya en ese nivel (lo calcula el servidor).
  const { Count = 0 } = await db.send(
    new QueryCommand({
      TableName: process.env.TABLA,
      KeyConditionExpression: 'altarId = :a',
      FilterExpression: 'nivel = :n',
      ExpressionAttributeValues: { ':a': altarId, ':n': item.nivel },
      Select: 'COUNT',
    }),
  )

  const id = randomUUID()
  const creadoEn = new Date().toISOString()
  const completo = { ...item, altarId, posicion: Count, id, creadoEn }

  await db.send(
    new PutCommand({
      TableName: process.env.TABLA,
      Item: { ...completo, sk: `${creadoEn}#${id}` },
    }),
  )
  return responder(201, completo)
}

export const handler = async (event) => {
  let cuerpo
  try {
    cuerpo = JSON.parse(event.body || '{}')
  } catch {
    return responder(400, { error: 'El cuerpo no es JSON válido.' })
  }

  const altarId = cuerpo.altarId
  if (!altarId) return responder(400, { error: 'Falta altarId.' })

  if (cuerpo.borrar === true) {
    if (!cuerpo.id) return responder(400, { error: 'Falta id.' })
    return borrar(altarId, cuerpo.id)
  }
  return crear(altarId, cuerpo)
}
