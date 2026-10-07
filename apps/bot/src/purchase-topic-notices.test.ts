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

describe('renderPurchaseTopicNotice', () => {
  test('renders saved purchase cards in English and Russian', () => {
    const en = renderPurchaseTopicNotice({
      locale: 'en',
      purchase: purchase(),
      members
    })
    expect(en.text).toContain('🧾 <b>Pizza</b> — <b>30.00 ₾</b>')
    expect(en.text).toContain('💳 Paid by: <b>Стас</b>')
    expect(en.text).toContain('• <s>Дима</s> · excluded')
    expect(en.parseMode).toBe('HTML')
    expect(en.replyMarkup?.inline_keyboard.length).toBe(2)

    const ru = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase(),
      members
    })
    expect(ru.text).toContain('🧾 <b>Pizza</b> — <b>30.00 ₾</b>')
    expect(ru.text).toContain('💳 Плательщик: <b>Стас</b>')
    expect(ru.text).toContain('• <s>Дима</s> · не участвует')

    const ruWithFemininePayer = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase({ payerMemberId: 'member-3' }),
      members
    })
    expect(ruWithFemininePayer.text).toContain('💳 Плательщик: <b>Алиса</b>')
    expect(ruWithFemininePayer.text).not.toContain('Оплатил: Алиса')
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

    expect(rendered.text).toContain('🧮 Индивидуальные суммы')
    expect(rendered.text).toContain('• Стас · 0.00 ₾')
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

    expect(rendered.text).toContain('➗ Поровну · по 7.00 ₾')
    expect(rendered.text).toContain(
      ['👥 <b>Участники</b>', '• Алиса · −7.00 ₾', '• Дима · −7.00 ₾', '• Стас · +14.00 ₾'].join(
        '\n'
      )
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

    expect(rendered.text).toContain('➗ Split equally\n')
    expect(rendered.text).toContain('• Стас · +$6.66')
    expect(rendered.text).toContain('• Дима · −$3.33')
    expect(rendered.text).toContain('• Алиса · −$3.33')
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

    expect(rendered.text).toContain('• Стас · +13.00 ₾')
    expect(rendered.text).toContain('• Алиса · −13.00 ₾')
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
    expect(excludedPayer.text).toContain('• Стас · +30.00 ₾ · без доли')
    expect(excludedPayer.text).toContain('• Дима · −30.00 ₾')

    const unlistedPayer = renderPurchaseTopicNotice({
      locale: 'en',
      purchase: purchase({
        participants: [
          { id: 'participant-2', memberId: 'member-2', included: true, shareAmountMinor: null }
        ]
      }),
      members
    })
    expect(unlistedPayer.text).toContain('• Дима · −30.00 ₾\n• Стас · +30.00 ₾ · no share')
  })

  test('does not offer excluded inactive participants as toggle targets', () => {
    const rendered = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase(),
      members: members.map((member) =>
        member.id === 'member-2' ? { ...member, status: 'away' as const } : member
      )
    })

    expect(rendered.text).toContain('• <s>Дима</s> · не участвует')
    expect(rendered.replyMarkup?.inline_keyboard.length).toBe(1)
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

    const button = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase(),
      members
    }).replyMarkup!.inline_keyboard[1]![0]!

    await bot.handleUpdate(callbackUpdate(button.callback_data) as never)

    expect(calls[0]).toMatchObject({
      method: 'editMessageText',
      payload: {
        parse_mode: 'HTML',
        text: expect.stringContaining('• Дима')
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

      const button = renderPurchaseTopicNotice({
        locale: 'ru',
        purchase: purchase(),
        members
      }).replyMarkup!.inline_keyboard[1]![0]!

      await bot.handleUpdate(callbackUpdate(button.callback_data) as never)

      expect(calls.map((call) => call.method)).toEqual(['answerCallbackQuery'])
      expect(JSON.stringify(calls[0]?.payload)).toContain(
        status === 'forbidden'
          ? 'Подтвердить или отменить'
          : 'должен остаться хотя бы один участник'
      )
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
    expect(rendered.text).toContain('• Стас · +$6.66')
    expect(rendered.text).toContain('• Дима · −$3.33')
    expect(rendered.text).toContain('• Алиса · −$3.33')
  }
})
