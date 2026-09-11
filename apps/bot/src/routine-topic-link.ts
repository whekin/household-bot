export interface RoutineTopicLink {
  chat: string
  threadId: number
  messageId: number
}
export function parseRoutineTopicLink(value: string): RoutineTopicLink {
  const fail = (): never => {
    throw new Error('Вставьте ссылку на сообщение внутри топика Telegram')
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return fail()
  }
  if (
    url.protocol !== 'https:' ||
    !['t.me', 'telegram.me'].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password
  )
    return fail()
  const parts = url.pathname.split('/').filter(Boolean)
  const privateLink = parts[0] === 'c'
  const channel = parts[privateLink ? 1 : 0]
  const ids = parts.slice(privateLink ? 2 : 1)
  if (
    !channel ||
    (privateLink ? !/^[1-9]\d{0,12}$/.test(channel) : !/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(channel))
  )
    return fail()
  if (ids.length < 1 || ids.length > 2 || url.searchParams.has('comment')) return fail()
  const queryThreads = url.searchParams.getAll('thread')
  if (queryThreads.length > 1) return fail()
  const thread = ids.length === 2 ? ids[0] : queryThreads[0]
  if (ids.length === 2 && queryThreads[0] && queryThreads[0] !== thread) return fail()
  const message = ids[ids.length - 1]
  const valid = (s: string | undefined) =>
    Boolean(s && /^[1-9]\d{0,9}$/.test(s) && Number(s) <= 2147483647)
  if (!valid(thread) || !valid(message)) return fail()
  return {
    chat: privateLink ? `-100${channel}` : `@${channel}`,
    threadId: Number(thread),
    messageId: Number(message)
  }
}
