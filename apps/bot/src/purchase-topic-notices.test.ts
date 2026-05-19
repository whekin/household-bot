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
    expect(en.text).toContain('Purchase: Pizza 30.00 ₾')
    expect(en.text).toContain('Paid by: Стас')
    expect(en.text).toContain('- Дима (excluded)')
    expect(en.replyMarkup?.inline_keyboard.length).toBe(2)

    const ru = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase(),
      members
    })
    expect(ru.text).toContain('Покупка: Pizza 30.00 ₾')
    expect(ru.text).toContain('Плательщик: Стас')
    expect(ru.text).toContain('- Дима (не участвует)')

    const ruWithFemininePayer = renderPurchaseTopicNotice({
      locale: 'ru',
      purchase: purchase({ payerMemberId: 'member-3' }),
      members
    })
    expect(ruWithFemininePayer.text).toContain('Плательщик: Алиса')
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

    expect(rendered.text).toContain('индивидуальные суммы')
    expect(rendered.replyMarkup).toBeUndefined()
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
        text: expect.stringContaining('- Дима')
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
