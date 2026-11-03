import { describe, expect, test } from 'bun:test'

import { instantFromIso } from '@household/domain'
import type {
  FinanceParsedPurchaseRecord,
  FinanceRepository,
  HouseholdConfigurationRepository,
  HouseholdMemberRecord
} from '@household/ports'

import { createTelegramBot } from './bot'
import {
  createPurchaseTopicNoticeService,
  renderPurchaseTopicNotice
} from './purchase-topic-notices'

const members: HouseholdMemberRecord[] = [
  {
    id: 'member-1',
    householdId: 'household-1',
    telegramUserId: '1001',
    displayName: 'Стас',
    status: 'active',
    preferredLocale: null,
    householdDefaultLocale: 'ru',
    rentShareWeight: 1,
    isAdmin: true
  },
  {
    id: 'member-2',
    householdId: 'household-1',
    telegramUserId: '1002',
    displayName: 'Дима',
    status: 'active',
    preferredLocale: null,
    householdDefaultLocale: 'ru',
    rentShareWeight: 1,
    isAdmin: false
  },
  {
    id: 'member-3',
    householdId: 'household-1',
    telegramUserId: '1003',
    displayName: 'Алиса',
    status: 'active',
    preferredLocale: null,
    householdDefaultLocale: 'ru',
    rentShareWeight: 1,
    isAdmin: false
  }
]

function purchase(input: Partial<FinanceParsedPurchaseRecord> = {}): FinanceParsedPurchaseRecord {
  return {
    id: input.id ?? 'purchase-1',
    cycleId: input.cycleId ?? 'cycle-1',
    cyclePeriod: input.cyclePeriod ?? '2026-03',
    createdByMemberId: input.createdByMemberId ?? 'member-1',
    payerMemberId: input.payerMemberId ?? 'member-1',
    amountMinor: input.amountMinor ?? 3000n,
    currency: input.currency ?? 'GEL',
    description: input.description ?? 'Pizza',
    occurredAt: input.occurredAt ?? instantFromIso('2026-03-12T12:00:00.000Z'),
    splitMode: input.splitMode ?? 'equal',
    participants: input.participants ?? [
      {
        id: 'participant-1',
        memberId: 'member-1',
        included: true,
        shareAmountMinor: null
      },
      {
        id: 'participant-2',
        memberId: 'member-2',
        included: false,
        shareAmountMinor: null
      }
    ]
  }
}

function householdRepository(): Pick<
  HouseholdConfigurationRepository,
  | 'findHouseholdTopicByTelegramContext'
  | 'getHouseholdChatByHouseholdId'
  | 'getHouseholdTopicBinding'
  | 'getHouseholdMember'
  | 'listHouseholdMembers'
> {
  return {
    findHouseholdTopicByTelegramContext: async () => ({
      householdId: 'household-1',
      role: 'purchase',
      telegramThreadId: '777',
      topicName: 'Purchases'
    }),
    getHouseholdChatByHouseholdId: async () => ({
      householdId: 'household-1',
      householdName: 'Kojori',
      telegramChatId: '-100123',
      telegramChatType: 'supergroup',
      title: 'Kojori',
      defaultLocale: 'ru'
    }),
    getHouseholdTopicBinding: async () => ({
      householdId: 'household-1',
      role: 'purchase',
      telegramThreadId: '777',
      topicName: 'Purchases'
    }),
    getHouseholdMember: async () => null,
    listHouseholdMembers: async () => members
  }
}

function setBotInfo(bot: ReturnType<typeof createTelegramBot>) {
  bot.botInfo = {
    id: 999000,
    is_bot: true,
    first_name: 'Household Test Bot',
    username: 'household_test_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: true,
    allows_users_to_create_topics: false
  }
}

function callbackUpdate(data: string) {
  return {
    update_id: 1001,
    callback_query: {
      id: 'callback-1',
      from: {
        id: 1002,
        is_bot: false,
        first_name: 'Dima'
      },
      chat_instance: 'chat-instance',
      data,
      message: {
        message_id: 9001,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: -100123,
          type: 'supergroup'
        },
        message_thread_id: 777,
        text: 'Purchase: Pizza 30.00 ₾'
      }
    }
  }
}

function participantButton(rendered: ReturnType<typeof renderPurchaseTopicNotice>, id: string) {
  const button = rendered.replyMarkup?.inline_keyboard
    .flat()
    .find((candidate) => candidate.callback_data === `purchase_saved:part:${id}`)
  if (!button) {
    throw new Error(`No toggle button for ${id}`)
  }
  return button
}

describe('renderPurchaseTopicNotice', () => {
  test('renders saved purchase cards in English and Russian', () => {
    const en = renderPurchaseTopicNotice({
      locale: 'en',
      purchase: purchase(),
      members
    })
    const [enHeadline, enPayer, ...enRest] = en.text.split('\n')
    expect(enHeadline).toBe('🛒 <b>Pizza · 30 ₾</b>')
    expect(enPayer).toStartWith('💳 Стас · ')
    expect(enRest).toEqual(['', 'Стас 0 ₾ · <s>Дима</s>'])
    expect(en.parseMode).toBe('HTML')
    // Toggles sit two per row.
    expect(en.replyMarkup?.inline_keyboard).toEqual([
      [
        { text: '✅ Стас', callback_data: 'purchase_saved:part:participant-1' },
        { text: '⬜ Дима', callback_data: 'purchase_saved:part:participant-2' }
      ]
    ])

    const ru = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase(),
      members
    })
    const [ruHeadline, ruPayer, ...ruRest] = ru.text.split('\n')
    expect(ruHeadline).toBe('🛒 <b>Pizza · 30 ₾</b>')
    expect(ruPayer).toStartWith('💳 Стас · ')
    expect(ruRest).toEqual(['', 'Стас 0 ₾ · <s>Дима</s>'])

    const ruWithFemininePayer = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase({ payerMemberId: 'member-3' }),
      members
    })
    expect(ruWithFemininePayer.text).toContain('\n💳 Алиса · ')
    expect(ruWithFemininePayer.text).not.toMatch(/[Оо]платил|[Кк]упил/)

    // Source bug: one included participant renders "split 1 ways" / "поровну на 1".
    expect(enPayer).not.toContain('1 ways')
    expect(ruPayer).not.toBe('💳 Стас · поровну на 1')
  })

  test('omits participant buttons for custom amount purchases', () => {
    const rendered = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase({
        splitMode: 'custom_amounts',
        participants: [
          {
            id: 'participant-1',
            memberId: 'member-1',
            included: true,
            shareAmountMinor: 3000n
          }
        ]
      }),
      members
    })

    expect(rendered.text).toBe('🛒 <b>Pizza · 30 ₾</b>\n💳 Стас · свои суммы\n\nСтас 0 ₾')
    expect(rendered.replyMarkup).toBeUndefined()
  })

  test('shows how each participant balance moves on an equal split', () => {
    const rendered = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase({
        amountMinor: 2100n,
        participants: [
          { id: 'participant-3', memberId: 'member-3', included: true, shareAmountMinor: null },
          { id: 'participant-2', memberId: 'member-2', included: true, shareAmountMinor: null },
          { id: 'participant-1', memberId: 'member-1', included: true, shareAmountMinor: null }
        ]
      }),
      members
    })

    expect(rendered.text).toBe(
      [
        '🛒 <b>Pizza · 21 ₾</b>',
        '💳 Стас · поровну на 3, по 7 ₾',
        '',
        'Алиса −7 ₾ · Дима −7 ₾',
        'Стас +14 ₾'
      ].join('\n')
    )
  })

  test('assigns uneven split remainders the way settlement does', () => {
    const rendered = renderPurchaseTopicNotice({
      locale: 'en',
      purchase: purchase({
        amountMinor: 1000n,
        currency: 'USD',
        participants: [
          { id: 'participant-1', memberId: 'member-1', included: true, shareAmountMinor: null },
          { id: 'participant-2', memberId: 'member-2', included: true, shareAmountMinor: null },
          { id: 'participant-3', memberId: 'member-3', included: true, shareAmountMinor: null }
        ]
      }),
      members
    })

    // No single per-head figure when the cents do not divide evenly.
    expect(rendered.text).toContain('💳 Стас · split 3 ways\n')
    expect(rendered.text).not.toContain(' each')
    expect(rendered.text).toEndWith('\n\nСтас +$6.66 · Дима −$3.33\nАлиса −$3.33')
  })

  test('uses custom shares for the balance change', () => {
    const rendered = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase({
        splitMode: 'custom_amounts',
        amountMinor: 2100n,
        participants: [
          { id: 'participant-1', memberId: 'member-1', included: true, shareAmountMinor: 800n },
          { id: 'participant-3', memberId: 'member-3', included: true, shareAmountMinor: 1300n }
        ]
      }),
      members
    })

    expect(rendered.text).toEndWith('\n\nСтас +13 ₾ · Алиса −13 ₾')
  })

  test('credits a payer who does not share the purchase', () => {
    const excludedPayer = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase({
        participants: [
          { id: 'participant-1', memberId: 'member-1', included: false, shareAmountMinor: null },
          { id: 'participant-2', memberId: 'member-2', included: true, shareAmountMinor: null }
        ]
      }),
      members
    })
    expect(excludedPayer.text).toEndWith('\n\nСтас +30 ₾ (без доли) · Дима −30 ₾')

    const unlistedPayer = renderPurchaseTopicNotice({
      locale: 'en',
      purchase: purchase({
        participants: [
          { id: 'participant-2', memberId: 'member-2', included: true, shareAmountMinor: null }
        ]
      }),
      members
    })
    expect(unlistedPayer.text).toEndWith('\n\nДима −30 ₾ · Стас +30 ₾ (no share)')
  })

  test('does not offer excluded inactive participants as toggle targets', () => {
    const rendered = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase(),
      members: members.map((member) =>
        member.id === 'member-2' ? { ...member, status: 'away' as const } : member
      )
    })

    expect(rendered.text).toEndWith('\n\nСтас 0 ₾ · <s>Дима</s>')
    expect(rendered.replyMarkup?.inline_keyboard).toEqual([
      [{ text: '✅ Стас', callback_data: 'purchase_saved:part:participant-1' }]
    ])
    expect(JSON.stringify(rendered.replyMarkup)).not.toContain('participant-2')
  })
})

describe('createPurchaseTopicNoticeService', () => {
  test('toggles a saved purchase participant and edits the same message', async () => {
    const bot = createTelegramBot('000000:test-token')
    setBotInfo(bot)
    const calls: Array<{ method: string; payload: unknown }> = []
    const updatedPurchase = purchase({
      participants: [
        {
          id: 'participant-1',
          memberId: 'member-1',
          included: true,
          shareAmountMinor: null
        },
        {
          id: 'participant-2',
          memberId: 'member-2',
          included: true,
          shareAmountMinor: null
        }
      ]
    })

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return { ok: true, result: true } as never
    })

    const repository: FinanceRepository = {
      getPurchaseTopicMessage: async () => ({
        purchaseMessageId: 'purchase-1',
        householdId: 'household-1',
        telegramChatId: '-100123',
        telegramThreadId: '777',
        telegramMessageId: '9001',
        status: 'sent',
        lastError: null
      })
    } as unknown as FinanceRepository

    createPurchaseTopicNoticeService({
      bot,
      householdConfigurationRepository: householdRepository(),
      financeRepositoryForHousehold: () => repository,
      financeServiceForHousehold: () =>
        ({
          togglePurchaseParticipant: async () => ({
            status: 'updated',
            purchase: updatedPurchase
          })
        }) as never
    })

    const button = participantButton(
      renderPurchaseTopicNotice({
        locale: 'ru',
        purchase: purchase(),
        members
      }),
      'participant-2'
    )
    expect(button.text).toBe('⬜ Дима')

    await bot.handleUpdate(callbackUpdate(button.callback_data) as never)

    expect(calls[0]).toMatchObject({
      method: 'editMessageText',
      payload: {
        chat_id: -100123,
        message_id: 9001,
        parse_mode: 'HTML',
        text: expect.stringContaining('\n\nСтас +15 ₾ · Дима −15 ₾')
      }
    })
    expect(JSON.stringify(calls[0]?.payload)).toContain('✅ Дима')
    expect(calls[1]?.method).toBe('answerCallbackQuery')
  })

  test('rejects non-member and last-participant toggles without editing', async () => {
    for (const status of ['forbidden', 'at_least_one_required'] as const) {
      const bot = createTelegramBot('000000:test-token')
      setBotInfo(bot)
      const calls: Array<{ method: string; payload: unknown }> = []

      bot.api.config.use(async (_prev, method, payload) => {
        calls.push({ method, payload })
        return { ok: true, result: true } as never
      })

      createPurchaseTopicNoticeService({
        bot,
        householdConfigurationRepository: householdRepository(),
        financeRepositoryForHousehold: () => ({}) as FinanceRepository,
        financeServiceForHousehold: () =>
          ({
            togglePurchaseParticipant: async () => ({ status })
          }) as never
      })

      const button = participantButton(
        renderPurchaseTopicNotice({
          locale: 'ru',
          purchase: purchase(),
          members
        }),
        'participant-2'
      )

      await bot.handleUpdate(callbackUpdate(button.callback_data) as never)

      expect(calls.map((call) => call.method)).toEqual(['answerCallbackQuery'])
      expect(calls[0]?.payload).toMatchObject({
        show_alert: true,
        text:
          status === 'forbidden'
            ? 'Менять это могут только участники дома'
            : 'Кто-то должен остаться в доле'
      })
    }
  })
})

test('uneven purchase card balances do not depend on database participant row order', () => {
  for (const order of [
    ['member-1', 'member-2', 'member-3'],
    ['member-2', 'member-1', 'member-3'],
    ['member-3', 'member-2', 'member-1']
  ]) {
    const rendered = renderPurchaseTopicNotice({
      locale: 'en',
      purchase: purchase({
        amountMinor: 1000n,
        currency: 'USD',
        participants: order.map((memberId) => ({
          memberId,
          included: true,
          shareAmountMinor: null
        }))
      }),
      members
    })
    // Lines follow the row order; the amounts must not.
    const changes = rendered.text.split('\n\n')[1]!.split(/ · |\n/)
    expect([...changes].sort()).toEqual(['Алиса −$3.33', 'Дима −$3.33', 'Стас +$6.66'])
  }
})
