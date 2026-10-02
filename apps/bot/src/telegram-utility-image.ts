import type { Context } from 'grammy'

const MAX_BYTES = 10 * 1024 * 1024

export function utilityImageFile(
  ctx: Pick<Context, 'message'>
): { fileId: string; size?: number } | null {
  const message = ctx.message
  if (!message) return null
  if ('photo' in message && message.photo?.length) {
    const photo = message.photo.reduce((a, b) => (a.width * a.height > b.width * b.height ? a : b))
    return {
      fileId: photo.file_id,
      ...(photo.file_size === undefined ? {} : { size: photo.file_size })
    }
  }
  if (
    'document' in message &&
    message.document &&
    ['image/png', 'image/jpeg'].includes(message.document.mime_type ?? '')
  ) {
    return {
      fileId: message.document.file_id,
      ...(message.document.file_size === undefined ? {} : { size: message.document.file_size })
    }
  }
  return null
}

export async function downloadTelegramUtilityImage(options: {
  token: string
  getFile: Context['api']['getFile']
  file: { fileId: string; size?: number }
  timeoutMs: number
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}): Promise<{ data: Uint8Array; mimeType: 'image/png' | 'image/jpeg' }> {
  if ((options.file.size ?? 0) > MAX_BYTES) throw new Error('Utility image too large')
  const file = await options.getFile(options.file.fileId)
  if (!file.file_path || (file.file_size ?? 0) > MAX_BYTES)
    throw new Error('Utility image unavailable')
  const response = await (options.fetch ?? fetch)(
    `https://api.telegram.org/file/bot${options.token}/${file.file_path.split('/').map(encodeURIComponent).join('/')}`,
    {
      signal: AbortSignal.timeout(options.timeoutMs)
    }
  )
  if (!response.ok || !response.body) throw new Error('Utility image download failed')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_BYTES) {
      await reader.cancel()
      throw new Error('Utility image too large')
    }
    chunks.push(value)
  }
  const data = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return { data, mimeType: 'image/jpeg' }
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => data[index] === byte))
    return { data, mimeType: 'image/png' }
  throw new Error('Unsupported utility image')
}
