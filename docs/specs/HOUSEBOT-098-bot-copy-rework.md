# Bot copy rework

## Summary

Every Telegram message, button and toast the bot sends is rewritten to one voice: short,
warm, gender-neutral and consistent across topics. The household also gets a "fully paid"
milestone for rent (utilities had one, rent did not), sent once per month from every payment
path. The command menu shrinks from 25 commands to the handful people actually use.

## Goals

- A reader understands any bot line at a glance: who, what, how much.
- The same action is described with the same words everywhere.
- Rent and utilities each announce "fully paid" exactly once per month.
- No user-facing English leaks into the Russian household, and the reverse.

## Non-goals

- Mini app copy (separate redesign already landed).
- Changing billing math or what a payment means.

## Voice

- Audience: flatmates in one Telegram group. Russian is primary, English must stay in sync.
- Tone: plain and short by default; warm and a little playful at success moments
  (milestones, receipts). Never bureaucratic ("запись платежа", "осуществить", "биллинг").
- Address: impersonal first ("Аренда оплачена", "Нужна сумма"). When a sentence must address
  the reader, use «вы». Never «ты».
- Gender-neutral Russian: no past-tense verbs that agree with a person ("оплатил", "отметил",
  "купил"). Use "Имя: что произошло", passive forms ("оплачено", "записано") or plural.

## Glossary

| RU                     | EN        | Not                                                 |
| ---------------------- | --------- | --------------------------------------------------- |
| аренда                 | rent      | —                                                   |
| коммуналка             | utilities | коммунальные платежи, начисления, коммунальный счёт |
| счёт (Свет, Газ)       | bill      | категория, начисление                               |
| покупка, общая покупка | purchase  | —                                                   |
| оплата                 | payment   | платёж (in UI text), запись платежа                 |
| месяц                  | month     | период, цикл, биллинг-цикл                          |
| приложение             | app       | мини-приложение, дашборд, Mini App                  |
| дом                    | household | домохозяйство                                       |
| топик                  | topic     | —                                                   |

## Formatting rules

- Money: `formatUserFacingMoney(amount, currency, locale)` from `apps/bot/src/i18n/money.ts` or
  `formatMoneyDisplay(minor, currency, locale)` from `@household/domain`. Whole amounts drop
  kopecks ("455 ₾"), others keep both digits ("5.50 ₾"). Never `toMajorString()` in user text,
  never a hand-written "₾".
- Months: `formatMonthDisplay(period, locale[, 'genitive'])` — "октябрь", "до ноября". Never a
  raw `YYYY-MM`, never a year, never "г.". Days: `formatDayDisplay(date, locale)` → "25 октября".
- Russian plurals: `pluralRu(count, [one, few, many])` from `@household/domain`.
- Emoji: at most one leading emoji per message, from this set only:
  🏠 rent · 💡 utilities · 🛒 purchase · ✅ done/paid · ⏳ waiting/unpaid · 🎉 milestone ·
  ✏️ edited · 🗑 deleted · ⏰ reminder · 📅 month · 🧹 chores · ⚠️ problem · 🔒 no access ·
  🕶 anonymous · 🤖 assistant. No emoji in the middle of sentences.
- Buttons: one or two words. Plain text, except ✅ on the primary positive action, ✅/⬜ on
  toggles (☑️/⬜ where ✅ already means "paid" in the same message), 📋 on copy buttons and 📱
  on the app link. The `/home` menu is the one place where every button carries an icon
  (💸 my bill, 🏠 household, 🛒 purchases, 🔎 details, 🧹 chores, 📱 app, 🕶 anonymous,
  ⚙️ setup, ❔ help). Cancel is always «Отмена» / "Cancel"; back is «Назад» / "Back" (the menu
  return button is «‹ Меню»). Short buttons sit two per row.
- Inside a card, lines may start with a status marker (✅ paid, ⏳ owes, • bill, 🏦 bank,
  💳 payer, ↩ purchase balance); these are list markers, not decoration.
- Toasts (`answerCallbackQuery`) are plain text, no HTML, one short phrase.
- Errors name the problem and the fix in one sentence.
- No filler: no "Подтвердите или отмените ниже 👇", no "подробности — в приложении" next to an
  app button, no restating what a button already says.
- HTML only where the send site sets `parse_mode: 'HTML'`; escape every interpolated name,
  description or model output with `escapeHtml`.
- Copy lives in a locale table, never in scattered `locale === 'ru' ? … : …` ternaries. Shared
  strings go to `apps/bot/src/i18n/locales/{ru,en}.ts`; a feature with many private strings
  keeps them in `apps/bot/src/i18n/<feature>.ts` as `{ ru, en }` typed from the Russian table.

## Notifications feed

One line per event: emoji, subject, what happened, amount, then context.

- `🏠 Ион: аренда за октябрь оплачена · 455 ₾ · 3 из 4`
- `🏠 Дима: аренда за октябрь оплачена · 455 ₾ · 3 из 4 · ✍️ Стас` (someone else recorded it)
- `🛒 Ион: Подсолнечное масло · 5.95 ₾`
- `🎉 Аренда за октябрь закрыта! Все 4 оплатили, 1 820 ₾ — можно выдыхать до ноября`
- "Подробнее" appears only when the expanded view adds something (custom split, excluded
  participants, already-paid members, several members' bills).

## Fully paid milestone

`HouseholdAuditNotificationService` takes a `paymentProgress` loader. After any payment event
(`payment.recorded`, `payment_period.closed`, `utility_plan.resolved|settled`,
`utility_vendor_payment.recorded`) it reads the month's state; rent lines carry "N из M", and
when the kind is fully paid it records `payment.fully_paid` with dedupe key
`payment.fully_paid:<kind>:<period>`. A unique index on
`household_audit_events (household_id, dedupe_key)` makes the announcement once-only even under
concurrent payments. The ad-hoc 🎉 replies in the payments topic and the
`utility_plan.fully_paid` events are removed.

## Commands

Kept: `/start` (deep links), `/home`, `/bill`, `/app`, `/anon`, `/cancel`, `/help`, `/setup`,
`/bind`, `/invite` (replaces `/join_link` and `/pending_members`), `/routines`, `/notifications`.

Removed with their handlers: `/settings`, `/dashboard`, `/bill_full`, `/my_bill`,
`/my_bill_full`, `/bill_json`, `/household_status`, `/balance`, `/payment_add`, `/utilities`,
`/keyboard`, `/approve_member`, `/unsetup`, `/cycle_open`, `/cycle_close`, `/rent_set`,
`/utility_add`, `/statement`. Their views stay reachable from `/home` and `/bill` buttons where
they are still useful; the mini app covers the admin actions.

## Data model changes

- `household_audit_events.dedupe_key text` with unique index
  `household_audit_events_household_dedupe_unique (household_id, dedupe_key)` (migration 0048).

## Test plan

- Domain: display formatter tests (money, month, day, plurals).
- Application: renderer tests per event type, milestone once-only and quiet-while-owing tests.
- Bot: updated expectations for every rewritten surface; payments topic no longer replies 🎉.

## Acceptance criteria

- [ ] Rent fully paid via the mini app posts one 🎉 line in Notifications.
- [ ] No user-facing string prints `.00`, a year, `YYYY-MM`, or a Telegram first name in place
      of the household name.
- [x] RU and EN catalogs have the same keys; no inline locale ternaries remain in bot surfaces.
- [x] Removed commands are gone from the menu and from the code.
- [x] Format, lint, typecheck, test and build pass.
