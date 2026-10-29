// POST /uploads            { altarId, contentType } -> { url, imageKey }  (firma de subida, 5 min)
// GET  /uploads/<imageKey>                          -> { url }            (firma de lectura, 1 h)
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// WHEN_REQUIRED evita firmar el checksum de un cuerpo vacío en la URL de PUT.
const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' })

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
}

const responder = (statusCode, cuerpo) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(cuerpo),
})

const EXTENSIONES = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const handler = async (event) => {
  const Bucket = process.env.BUCKET

  if (event.httpMethod === 'GET') {
    // El imageKey lleva un "/", por eso viene en la ruta greedy {proxy+}.
    const imageKey = decodeURIComponent(event.pathParameters?.proxy || '')
    if (!imageKey) return responder(400, { error: 'Falta la llave de la imagen.' })
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: imageKey }), {
      expiresIn: 3600,
    })
    return responder(200, { url })
  }

  let cuerpo
  try {
    cuerpo = JSON.parse(event.body || '{}')
  } catch {
    return responder(400, { error: 'El cuerpo no es JSON válido.' })
  }

  const { altarId, contentType } = cuerpo
  if (!altarId) return responder(400, { error: 'Falta altarId.' })
  const ext = EXTENSIONES[contentType]
  if (!ext) return responder(400, { error: 'El contentType debe ser jpeg, png, webp o gif.' })

  const imageKey = `${altarId}/${randomUUID()}.${ext}`
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket, Key: imageKey, ContentType: contentType }),
    { expiresIn: 300 },
  )
  return responder(200, { url, imageKey })
}
