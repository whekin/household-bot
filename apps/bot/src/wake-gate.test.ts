import { describe, expect, test } from 'bun:test'

import {
  assessWake,
  isRecentBotConversationFollowUp,
  mentionsBotName,
  type WakeClassifier
} from './wake-gate'

function classifierStub(
  verdict: {
    addressedToBot?: boolean
    completedPaymentFact?: boolean
    completedPurchaseFact?: boolean
    notificationRequest?: boolean
  } | null
): { classifier: WakeClassifier; calls: number[] } {
  const calls: number[] = []
  return {
    calls,
    classifier: async () => {
      calls.push(1)
      return verdict === null
        ? null
        : {
            addressedToBot: verdict.addressedToBot ?? false,
            completedPaymentFact: verdict.completedPaymentFact ?? false,
            completedPurchaseFact: verdict.completedPurchaseFact ?? false,
            notificationRequest: verdict.notificationRequest ?? false
          }
    }
  }
}

const baseInput = {
  topicRole: 'generic' as const,
  isExplicitMention: false,
  isReplyToBot: false,
  hasActiveWorkflow: false,
  hasRecentBotConversation: false,
  botUsername: 'kojori_bot',
  recentMessages: []
}

const recentAgentExchange = [
  {
    speaker: 'Стас',
    isBot: false,
    text: 'А почему это смешно?',
    senderTelegramUserId: '10002',
    sentAtEpochMilliseconds: 1_000
  },
  {
    speaker: 'BOT',
    isBot: true,
    text: 'Потому что коммуналка приходит без жалости ))',
    senderTelegramUserId: '999000',
    sentAtEpochMilliseconds: 2_000
  }
]

describe('mentionsBotName', () => {
  test('detects Russian bot names and username', () => {
    expect(mentionsBotName('Кожур, сколько я должен?')).toBe(true)
    expect(mentionsBotName('бот, ты тут?')).toBe(true)
    expect(mentionsBotName('спроси у кожори')).toBe(true)
    expect(mentionsBotName('@kojori_bot оплатил', 'kojori_bot')).toBe(true)
  })

  test('does not fire inside other words', () => {
    expect(mentionsBotName('забота о доме')).toBe(false)
    expect(mentionsBotName('мы работаем')).toBe(false)
  })
})

describe('assessWake', () => {
  test('wakes on explicit mention, reply, and active workflow without the classifier', async () => {
    const { classifier, calls } = classifierStub({ addressedToBot: false })

    expect(
      (
        await assessWake({
          ...baseInput,
          messageText: 'привет',
          isExplicitMention: true,
          classifier
        })
      ).reason
    ).toBe('mention')
    expect(
      (await assessWake({ ...baseInput, messageText: 'да', isReplyToBot: true, classifier })).reason
    ).toBe('reply_to_bot')
    expect(
      (await assessWake({ ...baseInput, messageText: 'да', hasActiveWorkflow: true, classifier }))
        .reason
    ).toBe('active_workflow')
    expect(calls).toHaveLength(0)
  })

  test('wakes for a verified continuation of a recent bot conversation', async () => {
    const { classifier, calls } = classifierStub({ addressedToBot: true })
    const decision = await assessWake({
      ...baseInput,
      messageText: 'Давай другой анекдот',
      hasRecentBotConversation: true,
      classifier
    })

    expect(decision).toEqual({ wake: true, reason: 'conversation_followup' })
    expect(calls).toHaveLength(1)
  })

  test('stays silent when a likely continuation is actually addressed to a housemate', async () => {
    const { classifier, calls } = classifierStub({ addressedToBot: false })
    const decision = await assessWake({
      ...baseInput,
      messageText: 'Ион, давай лучше другой анекдот',
      hasRecentBotConversation: true,
      classifier
    })

    expect(decision).toEqual({ wake: false, reason: 'silent' })
    expect(calls).toHaveLength(1)
  })

  test('stays silent for human-to-human coordination without calling the classifier', async () => {
    const { classifier, calls } = classifierStub({ addressedToBot: true })

    const decision = await assessWake({
      ...baseInput,
      messageText: 'Давай я твою долю оплачу, а ты, как вернёшься, отдашь с остальным?',
      classifier
    })

    expect(decision.wake).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('talking about the bot stays silent when the classifier says not addressed', async () => {
    const { classifier, calls } = classifierStub({ addressedToBot: false })

    const decision = await assessWake({
      ...baseInput,
      messageText: 'этот бот gpt2.0 от силы',
      classifier
    })

    expect(decision.wake).toBe(false)
    expect(calls).toHaveLength(1)
  })

  test('addressing the bot by name wakes when the classifier confirms', async () => {
    const { classifier } = classifierStub({ addressedToBot: true })

    const decision = await assessWake({
      ...baseInput,
      messageText: 'Бот, сколько я должен за коммуналку?',
      classifier
    })

    expect(decision).toEqual({ wake: true, reason: 'addressed' })
  })

  test('future payment intent in the payments topic stays silent', async () => {
    const { classifier, calls } = classifierStub({ completedPaymentFact: false })

    const decision = await assessWake({
      ...baseInput,
      topicRole: 'payments',
      messageText: 'Так, сегодня надо бы дооплатить',
      classifier
    })

    expect(decision.wake).toBe(false)
    expect(calls).toHaveLength(1)
  })

  test('a completed payment report in the payments topic wakes', async () => {
    const { classifier } = classifierStub({ completedPaymentFact: true })

    const decision = await assessWake({
      ...baseInput,
      topicRole: 'payments',
      messageText: 'Оплатил за себя и за иона',
      classifier
    })

    expect(decision).toEqual({ wake: true, reason: 'payment_fact' })
  })

  test('a payment fact outside the payments topic does not wake', async () => {
    const { classifier } = classifierStub({ completedPaymentFact: true })

    const decision = await assessWake({
      ...baseInput,
      topicRole: 'purchase',
      messageText: 'Оплатил аренду',
      classifier
    })

    expect(decision.wake).toBe(false)
  })

  test('a notification request in the reminders topic wakes', async () => {
    const { classifier } = classifierStub({ notificationRequest: true })

    const decision = await assessWake({
      ...baseInput,
      topicRole: 'reminders',
      messageText: 'напомни завтра вынести мусор',
      classifier
    })

    expect(decision).toEqual({ wake: true, reason: 'notification_request' })
  })

  test('classifier failure means silence', async () => {
    const { classifier } = classifierStub(null)

    const decision = await assessWake({
      ...baseInput,
      topicRole: 'payments',
      messageText: 'Оплатил аренду 469 лари',
      classifier
    })

    expect(decision.wake).toBe(false)
  })

  test('missing classifier means silence for non-deterministic triggers', async () => {
    const decision = await assessWake({
      ...baseInput,
      topicRole: 'payments',
      messageText: 'Оплатил аренду 469 лари'
    })

    expect(decision.wake).toBe(false)

    const followUpDecision = await assessWake({
      ...baseInput,
      messageText: 'Давай другой анекдот',
      hasRecentBotConversation: true
    })
    expect(followUpDecision).toEqual({ wake: false, reason: 'silent' })
  })
})

describe('isRecentBotConversationFollowUp', () => {
  test('continues a fresh exchange between the same member and the bot', () => {
    expect(
      isRecentBotConversationFollowUp({
        senderTelegramUserId: '10002',
        messageSentAtEpochMilliseconds: 60_000,
        recentMessages: recentAgentExchange
      })
    ).toBe(true)
  })

  test('stays silent after another housemate joins the conversation', () => {
    expect(
      isRecentBotConversationFollowUp({
        senderTelegramUserId: '10002',
        messageSentAtEpochMilliseconds: 60_000,
        recentMessages: [
          ...recentAgentExchange,
          {
            speaker: 'Ион',
            isBot: false,
            text: 'Стас, давай лучше без анекдотов',
            senderTelegramUserId: '10003',
            sentAtEpochMilliseconds: 30_000
          }
        ]
      })
    ).toBe(false)
  })

  test('does not reuse a stale or unrelated bot message', () => {
    expect(
      isRecentBotConversationFollowUp({
        senderTelegramUserId: '10002',
        messageSentAtEpochMilliseconds: 5 * 60_000 + 2_001,
        recentMessages: recentAgentExchange
      })
    ).toBe(false)

    expect(
      isRecentBotConversationFollowUp({
        senderTelegramUserId: '10003',
        messageSentAtEpochMilliseconds: 60_000,
        recentMessages: recentAgentExchange
      })
    ).toBe(false)
  })
})
