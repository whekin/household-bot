import { describe, expect, test } from 'bun:test'

import type { AdHocNotificationService, HouseholdOnboardingService } from '@household/application'

import {
  createMiniAppCancelNotificationHandler,
  createMiniAppUpdateNotificationHandler
} from './miniapp-notifications'
import { buildMiniAppInitData } from './telegram-miniapp-test-helpers'

function onboardingService(): HouseholdOnboardingService {
  return {
    ensureHouseholdJoinToken: async () => ({
      householdId: 'household-1',
      householdName: 'Kojori House',
      token: 'join-token'
    }),
    getMiniAppAccess: async () => ({
      status: 'active',
      member: {
        id: 'member-1',
        householdId: 'household-1',
        householdName: 'Kojori House',
        displayName: 'Stas',
        status: 'active',
        isAdmin: true,
        preferredLocale: 'ru',
        householdDefaultLocale: 'ru',
        rentShareWeight: 1
      }
    }),
    joinHousehold: async () => ({
      status: 'active',
      member: {
        id: 'member-1',
        householdId: 'household-1',
        householdName: 'Kojori House',
        displayName: 'Stas',
        status: 'active',
        isAdmin: true,
        preferredLocale: 'ru',
        householdDefaultLocale: 'ru',
        rentShareWeight: 1
      }
    })
  }
}

function notificationService(): AdHocNotificationService {
  return {
    scheduleNotification: async () => ({ status: 'scheduled', notification: null as never }),
    listUpcomingNotifications: async () => [],
    cancelNotification: async () => ({ status: 'cancelled', notification: null as never }),
    updateNotification: async () => ({ status: 'updated', notification: null as never }),
    listDueNotifications: async () => [],
    claimDueNotification: async () => true,
    releaseDueNotification: async () => {},
    markNotificationSent: async () => null as never
  }
}

describe('miniapp notification handlers', () => {
  const botToken = '123456:ABCDEF'

  test('update handler authenticates without consuming the notification payload', async () => {
    const handler = createMiniAppUpdateNotificationHandler({
      allowedOrigins: ['https://miniapp.example'],
      botToken,
      onboardingService: onboardingService(),
      adHocNotificationService: {
        ...notificationService(),
        async updateNotification(input) {
          expect(input.notificationId).toBe('notification-1')
          expect(input.deliveryMode).toBe('topic')
          expect(input.scheduledFor?.toString()).toBe('2026-03-25T07:00:00Z')
          return { status: 'updated', notification: null as never }
        }
      }
    }).handler

    const response = await handler(
      new Request('https://example.test/api/miniapp/notifications/update', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://miniapp.example'
        },
        body: JSON.stringify({
          initData: buildMiniAppInitData(botToken, Math.floor(Date.now() / 1000), {
            id: 123456,
            first_name: 'Stas',
            language_code: 'ru'
          }),
          notificationId: 'notification-1',
          scheduledLocal: '2026-03-25T11:00',
          timezone: 'Asia/Tbilisi',
          deliveryMode: 'topic'
        })
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      authorized: true
    })
  })

  test('cancel handler authenticates without consuming the notification payload', async () => {
    const handler = createMiniAppCancelNotificationHandler({
      allowedOrigins: ['https://miniapp.example'],
      botToken,
      onboardingService: onboardingService(),
      adHocNotificationService: {
        ...notificationService(),
        async cancelNotification(input) {
          expect(input.notificationId).toBe('notification-1')
          expect(input.viewerMemberId).toBe('member-1')
          return { status: 'cancelled', notification: null as never }
        }
      }
    }).handler

    const response = await handler(
      new Request('https://example.test/api/miniapp/notifications/cancel', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://miniapp.example'
        },
        body: JSON.stringify({
          initData: buildMiniAppInitData(botToken, Math.floor(Date.now() / 1000), {
            id: 123456,
            first_name: 'Stas',
            language_code: 'ru'
          }),
          notificationId: 'notification-1'
        })
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      authorized: true
    })
  })
})
