import assert from 'node:assert/strict'
import { matchUtilityImageBills, previewUtilityBillImport } from '@household/application'
import { createOpenAiUtilityImageRecognizer } from '../../apps/bot/src/openai-utility-image-recognizer'

// Opt-in image replay only: no Telegram calls, database connection or finance writes.
const paths = process.argv.slice(2)
if (!paths.length || !process.env.OPENAI_API_KEY)
  throw new Error('Usage: OPENAI_API_KEY=... bun run scripts/e2e/utility-screenshot.ts IMAGE...')
const recognize = createOpenAiUtilityImageRecognizer({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.ASSISTANT_MODEL?.trim() || 'gpt-5.6-terra',
  timeoutMs: 60000
})
const categories = [
  ['electricity', 'Electricity'],
  ['cleaning', 'Cleaning'],
  ['gas_water', 'Gas (Water)'],
  ['internet', 'Internet']
].map(([slug, name], i) => ({
  id: `sample-${i}`,
  householdId: 'sample',
  slug: slug!,
  name: name!,
  sortOrder: i,
  isActive: true
}))
for (const path of paths) {
  const file = Bun.file(path)
  assert(file.size <= 10 * 1024 * 1024, 'Image exceeds 10 MiB')
  const recognition = await recognize({
    data: new Uint8Array(await file.arrayBuffer()),
    mimeType: path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
  })
  assert.equal(recognition.kind, 'utility_balances')
  const matched = matchUtilityImageBills(recognition, categories)
  assert.deepEqual(matched.issues, [])
  const preview = previewUtilityBillImport('2026-10', matched.entries, {
    revision: 'sample',
    closed: false,
    hasPayments: false,
    paidByBillId: {},
    categories,
    bills: []
  })
  console.log(
    JSON.stringify({
      image: path.split('/').at(-1),
      entries: preview.entries,
      totalMajor: preview.totalMajor
    })
  )
}
