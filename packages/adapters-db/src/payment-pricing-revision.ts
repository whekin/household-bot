import { sql } from 'drizzle-orm'
import type { createDbClient } from '@household/db'

type Reader = Pick<ReturnType<typeof createDbClient>['db'], 'execute'>

/** A database-side fingerprint avoids rounding bigint JSON values in JavaScript. */
export async function paymentPricingRevision(
  reader: Reader,
  householdId: string,
  cycleId: string
): Promise<string> {
  const rows = await reader.execute(sql`
    SELECT md5(jsonb_build_object(
      'bills', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM utility_bills t WHERE household_id = ${householdId} AND cycle_id = ${cycleId}),
      'plans', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM utility_billing_plans t WHERE household_id = ${householdId} AND cycle_id = ${cycleId}),
      'fx', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing_cycle_exchange_rates t WHERE cycle_id = ${cycleId}),
      'rent', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM rent_rules t WHERE household_id = ${householdId}),
      'settings', (SELECT to_jsonb(t) FROM household_billing_settings t WHERE household_id = ${householdId}),
      'members', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM members t WHERE household_id = ${householdId}),
      'presence', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM member_presence_days t WHERE household_id = ${householdId}),
      'purchases', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM purchase_messages t WHERE household_id = ${householdId}),
      'participants', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM purchase_message_participants t WHERE purchase_message_id IN (SELECT id FROM purchase_messages WHERE household_id = ${householdId})),
      'repayments', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM member_repayments t WHERE household_id = ${householdId}),
      'receipts', (SELECT jsonb_agg(jsonb_build_array(id,member_id,kind,amount_minor,currency,funding_phase) ORDER BY id) FROM payment_records WHERE household_id = ${householdId} AND cycle_id = ${cycleId}),
      'allocations', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM payment_purchase_allocations t WHERE resolution_cycle_id = ${cycleId}),
      'providers', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM utility_vendor_payment_facts t WHERE household_id = ${householdId} AND cycle_id = ${cycleId})
    )::text) AS revision
  `)
  return String(rows[0]!.revision)
}
