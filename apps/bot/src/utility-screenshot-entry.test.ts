import { expect, test } from 'bun:test'
import { createUtilityBillImportService } from '@household/application'
import { Money, nowInstant } from '@household/domain'
import type {
  TelegramPendingActionRecord,
  TelegramPendingActionRepository,
  UtilityBillImportSnapshot,
  UtilityImageRecognition
} from '@household/ports'
import { createTelegramBot } from './bot'
import { registerUtilityScreenshotEntry } from './utility-screenshot-entry'

const image: UtilityImageRecognition = {
  kind: 'utility_balances',
  bills: [
    ['LLC TELMICO (electricity)', '-44.02'],
    ['Tbilisi Cleaning', '-2.50'],
    ['SOCAR Natural gas', '-20.30'],
    ['Silknet', '-61.39']
  ].map(([provider, amountMajor]) => ({
    provider: provider!,
    amountMajor: amountMajor!,
    currency: 'GEL',
    customerNumber: 'account',
    category: null,
    confidence: 0.99
  }))
}
const categories = [
  ['electricity', 'Electricity'],
  ['cleaning', 'Cleaning'],
  ['gas_water', 'Gas (Water)'],
  ['internet', 'Internet']
].map(([slug, name], i) => ({
  id: `cat-${i}`,
  householdId: 'h',
  slug: slug!,
  name: name!,
  sortOrder: i,
  isActive: true
}))

function photo(
  input: {
    reply?: 'utility' | 'rent' | 'other' | 'human'
    caption?: string
    fromId?: number
    thread?: number | null
    document?: string
    period?: string
  } = {}
) {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 1,
      chat: { id: -100123, type: 'supergroup' },
      from: { id: input.fromId ?? 42, is_bot: false, first_name: 'Stas' },
      ...(input.thread === null
        ? {}
        : { message_thread_id: input.thread ?? 555, is_topic_message: true }),
      ...(input.document
        ? { document: { file_id: 'file', file_unique_id: 'unique', mime_type: input.document } }
        : { photo: [{ file_id: 'photo', file_unique_id: 'unique', width: 900, height: 2000 }] }),
      ...(input.caption ? { caption: input.caption } : {}),
      ...(input.reply
        ? {
            reply_to_message: {
              message_id: 77,
              date: 1,
              chat: { id: -100123, type: 'supergroup' },
              from: {
                id: input.reply === 'human' ? 456 : 999,
                is_bot: input.reply !== 'human',
                first_name: 'Bot'
              },
              text: 'Reminder',
              ...(input.reply === 'utility' || input.reply === 'rent'
                ? {
                    reply_markup: {
                      inline_keyboard: [
                        [
                          {
                            text: 'Paid',
                            callback_data: `pr:p:${input.reply === 'utility' ? 'utilities' : 'rent'}:${input.period ?? '2026-10'}`
                          }
                        ]
                      ]
                    }
                  }
                : {})
            }
          }
        : {})
    }
  }
}

function setup(
  input: {
    recognition?: UtilityImageRecognition
    failOcr?: boolean
    unavailable?: boolean
    failPublish?: boolean
    noMember?: boolean
    memberStatus?: string
    failAcknowledgement?: boolean
  } = {}
) {
  const bot = createTelegramBot('000:test')
  bot.botInfo = {
    id: 999,
    is_bot: true,
    first_name: 'Test',
    username: 'household_test_bot',
    can_join_groups: true,
    can_read_all_group_messages: true,
    supports_inline_queries: false
  } as never
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = []
  let messageId = 100
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> })
    if (input.failAcknowledgement && method === 'editMessageText')
      throw new Error('Message no longer editable')
    return {
      ok: true,
      result: method === 'sendMessage' ? { message_id: ++messageId } : true
    } as never
  })
  let pending: TelegramPendingActionRecord | null = null
  const prompts: TelegramPendingActionRepository = {
    upsertPendingAction: async (record) => {
      pending = record
      return record
    },
    getPendingAction: async (chat, user) =>
      pending?.telegramChatId === chat &&
      pending.telegramUserId === user &&
      (!pending.expiresAt || pending.expiresAt.epochMilliseconds > nowInstant().epochMilliseconds)
        ? pending
        : null,
    consumePendingActionByPayloadValue: async (chat, user, action, key, value) => {
      const found = await prompts.getPendingAction(chat, user, action)
      if (!found || found.payload[key] !== value) return null
      pending = null
      return found
    },
    clearPendingAction: async () => {
      pending = null
    },
    clearPendingActionsForChat: async () => {
      pending = null
    }
  }
  let snapshot: UtilityBillImportSnapshot = {
    revision: 'r1',
    closed: false,
    hasPayments: false,
    paidByBillId: {},
    categories,
    bills: []
  }
  const imports: Array<{ period: string; names: string[] }> = []
  const importService = createUtilityBillImportService({
    getSnapshot: async () => snapshot,
    apply: async (change) => {
      if (snapshot.revision !== change.expectedRevision) return 'stale'
      imports.push({ period: change.period, names: change.changes.map((bill) => bill.billName) })
      snapshot = {
        ...snapshot,
        revision: 'r2',
        bills: change.changes.map((bill, i) => ({
          id: bill.billId ?? `bill-${i}`,
          billName: bill.billName,
          amountMinor: bill.amountMinor,
          currency: 'GEL'
        }))
      }
      return 'applied'
    }
  })
  let ocrCalls = 0
  let downloadCalls = 0
  let refreshCalls = 0
  let publishCalls = 0
  let passed = 0
  let storedCard: Record<string, unknown> | null = null
  const member = {
    id: 'member',
    householdId: 'h',
    telegramUserId: '42',
    displayName: 'Stas',
    status: input.memberStatus ?? 'active',
    preferredLocale: 'ru',
    householdDefaultLocale: 'ru',
    isAdmin: false,
    rentShareWeight: 1
  }
  registerUtilityScreenshotEntry({
    bot,
    token: 'test-token',
    timeoutMs: 1000,
    promptRepository: prompts,
    householdConfigurationRepository: {
      getTelegramHouseholdChat: async () => ({ householdId: 'h', defaultLocale: 'ru' }),
      getHouseholdMember: async (_house: string, user: string) =>
        input.noMember || user !== '42' ? null : member,
      listHouseholdMembersByTelegramUserId: async () => [member],
      listHouseholdUtilityCategories: async () => categories,
      getHouseholdBillingSettings: async () => ({ timezone: 'Asia/Tbilisi' })
    } as never,
    financeServiceForHousehold: () =>
      ({
        getMemberByTelegramUserId: async () => member,
        generateDashboard: async () => ({
          currency: 'GEL',
          utilityBillingPlan: {
            memberSummaries: [
              {
                memberId: 'member',
                displayName: 'Ion',
                assignedThisCycle: Money.fromMajor('10.00', 'GEL')
              }
            ]
          }
        })
      }) as never,
    importServiceForHousehold: () => importService,
    paymentCardRepository: { findPaymentCard: async () => storedCard } as never,
    ...(input.unavailable
      ? {}
      : {
          recognize: async () => {
            ocrCalls++
            if (input.failOcr) throw new Error('OCR down')
            return input.recognition ?? image
          }
        }),
    downloadImage: async () => {
      downloadCalls++
      return { data: new Uint8Array(), mimeType: 'image/png' }
    },
    livePaymentCardService: {
      refresh: async () => {
        refreshCalls++
      }
    } as never,
    paymentInstructionPublisher: {
      sendPaymentInstruction: async () => {
        publishCalls++
        if (input.failPublish) throw new Error('Telegram down')
        return { status: 'sent' }
      }
    }
  })
  bot.on('message', () => {
    passed++
  })
  async function callback(action: string, fromId = 42, thread: number | null = 555, id?: string) {
    await bot.handleUpdate({
      update_id: 2,
      callback_query: {
        id: crypto.randomUUID(),
        chat_instance: 'chat',
        from: { id: fromId, is_bot: false, first_name: 'Stas' },
        data: `us:${action}:${id ?? pending?.payload.proposalId}`,
        message: {
          message_id: 101,
          date: 1,
          chat: { id: -100123, type: 'supergroup' },
          ...(thread ? { message_thread_id: thread, is_topic_message: true } : {}),
          text: 'Preview'
        }
      }
    } as never)
  }
  async function textReply(text: string, replyId?: number) {
    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 90,
        date: 1,
        chat: { id: -100123, type: 'supergroup' },
        from: { id: 42, is_bot: false, first_name: 'Stas' },
        message_thread_id: 555,
        is_topic_message: true,
        text,
        reply_to_message: {
          message_id: replyId ?? pending!.payload.inputMessageId,
          date: 1,
          chat: { id: -100123, type: 'supergroup' },
          from: { id: 999, is_bot: true, first_name: 'Bot' },
          text: 'Prompt'
        }
      }
    } as never)
  }
  return {
    bot,
    calls,
    imports,
    callback,
    textReply,
    pending: () => pending,
    setSnapshot: (value: Partial<UtilityBillImportSnapshot>) => {
      snapshot = { ...snapshot, ...value }
    },
    setCard: (value: Record<string, unknown>) => {
      storedCard = value
    },
    expire: () => {
      if (pending) pending.expiresAt = nowInstant().subtract({ hours: 1 })
    },
    metrics: () => ({ ocrCalls, downloadCalls, refreshCalls, publishCalls, passed }),
    messages: () =>
      calls
        .filter((call) => call.method === 'sendMessage' || call.method === 'editMessageText')
        .map((call) => String(call.payload.text))
  }
}

test('reply to a historical utility reminder previews exact amounts before actor confirmation', async () => {
  const f = setup()
  await f.bot.handleUpdate(photo({ reply: 'utility', period: '2026-09' }) as never)
  expect(f.imports).toEqual([])
  expect(f.pending()?.payload.period).toBe('2026-09')
  expect(f.messages().join()).toContain('128.21')
  await f.callback('save')
  expect(f.imports).toEqual([
    { period: '2026-09', names: ['Electricity', 'Cleaning', 'Gas (Water)', 'Internet'] }
  ])
  expect(f.metrics().refreshCalls).toBe(1)
  expect(f.metrics().publishCalls).toBe(1)
})

test('ordinary groups without a utilities topic support reminder replies', async () => {
  const f = setup()
  await f.bot.handleUpdate(photo({ reply: 'utility', thread: null }) as never)
  await f.callback('save', 42, null)
  expect(f.imports).toHaveLength(1)
})

test('persisted fully paid utility cards retain their original month without keyboard callbacks', async () => {
  const f = setup()
  f.setCard({ householdId: 'h', kind: 'utilities', period: '2026-08', telegramThreadId: '555' })
  await f.bot.handleUpdate(photo({ reply: 'other' }) as never)
  expect(f.pending()?.payload.period).toBe('2026-08')
})

test('random group photos and replies to humans do not call OCR or save', async () => {
  for (const update of [photo(), photo({ reply: 'human' }), photo({ caption: 'коммуналка' })]) {
    const f = setup()
    await f.bot.handleUpdate(update as never)
    expect(f.metrics().ocrCalls).toBe(0)
    expect(f.metrics().downloadCalls).toBe(0)
    expect(f.messages()).toEqual([])
    expect(f.metrics().passed).toBe(1)
  }
})

test('addressed random screenshot and rent reminder reply give instructions without OCR', async () => {
  for (const update of [
    photo({ caption: '@household_test_bot что тут?' }),
    photo({ reply: 'rent' }),
    photo({ reply: 'other' })
  ]) {
    const f = setup()
    await f.bot.handleUpdate(update as never)
    expect(f.metrics().ocrCalls).toBe(0)
    expect(f.messages().join()).toContain('ответ на напоминание')
  }
})

test('explicit caption allows screenshots without a reply; purchase captions keep their existing flow', async () => {
  const f = setup()
  await f.bot.handleUpdate(photo({ caption: '@household_test_bot коммуналка' }) as never)
  expect(f.metrics().ocrCalls).toBe(1)
  expect(f.pending()?.payload.period).toMatch(/^\d{4}-\d{2}$/)
  const purchase = setup()
  await purchase.bot.handleUpdate(
    photo({ caption: '@household_test_bot купил корм 12 лари' }) as never
  )
  expect(purchase.metrics().passed).toBe(1)
  expect(purchase.metrics().ocrCalls).toBe(0)
  const payment = setup()
  await payment.bot.handleUpdate(
    photo({ reply: 'utility', caption: 'Я оплатил коммуналку' }) as never
  )
  expect(payment.metrics().passed).toBe(1)
  expect(payment.metrics().ocrCalls).toBe(0)
})

test('unrelated screenshot, receipt, unreadable and failed OCR leave the ledger unchanged', async () => {
  for (const kind of ['unrelated', 'payment_receipt', 'unreadable'] as const) {
    const f = setup({ recognition: { kind, bills: [] } })
    await f.bot.handleUpdate(photo({ reply: 'utility' }) as never)
    expect(f.pending()).toBeNull()
    expect(f.imports).toEqual([])
    expect(f.messages().join()).toContain(
      kind === 'payment_receipt' ? 'Оплата не записана' : 'Ничего не сохранено'
    )
  }
  const failed = setup({ failOcr: true })
  await failed.bot.handleUpdate(photo({ reply: 'utility' }) as never)
  expect(failed.messages().join()).toContain('Ничего не сохранено')
})

test('unsupported files, unconfigured OCR, unknown and departed members never run recognition', async () => {
  for (const input of [{ unavailable: true }, { noMember: true }, { memberStatus: 'left' }]) {
    const f = setup(input)
    await f.bot.handleUpdate(photo({ reply: 'utility' }) as never)
    expect(f.metrics().ocrCalls).toBe(0)
    expect(f.pending()).toBeNull()
  }
  const f = setup()
  await f.bot.handleUpdate(photo({ reply: 'utility', document: 'application/pdf' }) as never)
  expect(f.metrics().ocrCalls).toBe(0)
})

test('wrong actor, foreign thread, expiry and repeated confirmation cannot save', async () => {
  const f = setup()
  await f.bot.handleUpdate(photo({ reply: 'utility' }) as never)
  const id = String(f.pending()!.payload.proposalId)
  await f.callback('save', 43)
  await f.callback('save', 42, 556)
  expect(f.imports).toEqual([])
  await f.callback('save')
  await f.callback('save', 42, 555, id)
  expect(f.imports).toHaveLength(1)
  const expired = setup()
  await expired.bot.handleUpdate(photo({ reply: 'utility' }) as never)
  expired.expire()
  await expired.callback('save')
  expect(expired.imports).toEqual([])
})

test('edits reject detached values, preserve incomplete categories and require fresh confirmation', async () => {
  const f = setup()
  await f.bot.handleUpdate(photo({ reply: 'utility' }) as never)
  await f.callback('edit')
  await f.textReply('Electricity:\n44.02')
  expect(f.pending()!.payload.stage).toBe('edit')
  await f.textReply('Electricity: 44,02\nInternet: 0\nCleaning:')
  expect(f.pending()!.payload.stage).toBe('review')
  expect(f.imports).toEqual([])
  await f.callback('save')
  expect(f.imports[0]!.names).toEqual(['Electricity', 'Internet'])
})

test('month change and cancellation never save prematurely', async () => {
  const f = setup()
  await f.bot.handleUpdate(photo({ reply: 'utility' }) as never)
  await f.callback('month')
  await f.textReply('2026-13')
  expect(f.pending()!.payload.stage).toBe('month')
  await f.textReply('2026-11')
  expect(f.pending()!.payload.period).toBe('2026-11')
  await f.callback('cancel')
  expect(f.pending()).toBeNull()
  expect(f.imports).toEqual([])
})

test('changed snapshots force a refreshed review and payments block import', async () => {
  const f = setup()
  await f.bot.handleUpdate(photo({ reply: 'utility' }) as never)
  f.setSnapshot({ revision: 'new' })
  await f.callback('save')
  expect(f.imports).toEqual([])
  expect(f.messages().join()).toContain('Данные за месяц изменились')
  f.setSnapshot({ revision: 'paid', hasPayments: true })
  await f.callback('save')
  expect(f.imports).toEqual([])
  expect(f.messages().join()).toContain('Уже записанные оплаты сохранятся')
})

test('two bank screenshots with matching amounts cannot duplicate charges', async () => {
  const f = setup()
  await f.bot.handleUpdate(photo({ reply: 'utility' }) as never)
  await f.callback('save')
  await f.bot.handleUpdate(photo({ reply: 'utility' }) as never)
  expect(f.messages().join()).toContain('Повторных начислений не будет')
  await f.callback('save')
  expect(f.imports).toHaveLength(1)
})

test('unknown supplier blocks save until explicit manual correction', async () => {
  const f = setup({
    recognition: { ...image, bills: [...image.bills, { ...image.bills[0]!, provider: 'Unknown' }] }
  })
  await f.bot.handleUpdate(photo({ reply: 'utility' }) as never)
  await f.callback('save')
  expect(f.imports).toEqual([])
  expect(f.messages().join()).toContain('Не все строки')
  await f.callback('edit')
  await f.textReply('Electricity: 44.02')
  await f.callback('save')
  expect(f.imports).toHaveLength(1)
})

test('post-save publication failure reports saved bills without reopening the import', async () => {
  const f = setup({ failPublish: true })
  await f.bot.handleUpdate(photo({ reply: 'utility' }) as never)
  await f.callback('save')
  expect(f.imports).toHaveLength(1)
  expect(f.pending()).toBeNull()
  expect(f.messages().join()).toContain('Счета сохранены, но')
})

test('an uneditable preview does not prevent refreshing cards after a successful save', async () => {
  const f = setup({ failAcknowledgement: true })
  await f.bot.handleUpdate(photo({ reply: 'utility' }) as never)
  await f.callback('save')
  expect(f.imports).toHaveLength(1)
  expect(f.metrics().refreshCalls).toBe(1)
  expect(f.metrics().publishCalls).toBe(1)
  expect(f.messages().join()).toContain('Счета сохранены, но')
})
