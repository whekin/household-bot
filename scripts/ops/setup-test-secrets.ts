import { $ } from 'bun'

const PROJECT_ID = 'gen-lang-client-0200379851'

async function secretExists(name: string): Promise<boolean> {
  const result =
    (await $`gcloud secrets describe ${name} --project=${PROJECT_ID}`.quiet().exitCode) === 0
  return result
}

async function createSecret(name: string, value: string) {
  console.log(`\n[Checking] ${name}...`)
  if (await secretExists(name)) {
    console.log(`[Skipping] ${name} already exists. If you want to change it, use the GCP console.`)
    return
  }

  try {
    console.log(`[Creating] ${name} for the first time...`)
    await $`echo -n ${value} | gcloud secrets create ${name} --data-file=- --replication-policy="automatic" --project=${PROJECT_ID}`.quiet()
    console.log(`[Success] ${name} is ready.`)
  } catch (err) {
    console.error(`[Error] Failed to setup ${name}:`, err)
  }
}

console.log('--- Production & Test Environment Secret Setup ---')
console.log(`Target Project: ${PROJECT_ID}`)

// 1. PRODUCTION Bot Token
let prodBotToken = ''
if (!(await secretExists('telegram-bot-token'))) {
  prodBotToken = prompt('1. Enter your PRODUCTION Telegram Bot Token (the original one):') || ''
}

// 2. PRODUCTION Database URL
let prodDbUrl = ''
if (!(await secretExists('database-url'))) {
  prodDbUrl = prompt('2. Enter your PRODUCTION Supabase DATABASE_URL (for public schema):') || ''
}

// 3. TEST Bot Token
let testBotToken = ''
if (!(await secretExists('telegram-bot-token-test'))) {
  testBotToken = prompt('3. Enter your TEST Telegram Bot Token (from @BotFather):') || ''
}

// 4. TEST Database URL (Derived from prod if not exists)
let testDbUrlPrompt = ''
if (!(await secretExists('database-url-test'))) {
  testDbUrlPrompt =
    prompt(
      '4. Enter your TEST Supabase DATABASE_URL (or leave empty to reuse prod with ?options=-csearch_path=test):'
    ) || ''
}

// 5. OpenAI API Key (Shared)
let openaiKey = ''
if (!(await secretExists('openai-api-key'))) {
  openaiKey = prompt('5. Enter your OpenAI API Key:') || ''
}

// Logic for test DB URL
const testDbUrl =
  testDbUrlPrompt ||
  (prodDbUrl &&
    (prodDbUrl.includes('?')
      ? `${prodDbUrl}&options=-csearch_path%3Dtest`
      : `${prodDbUrl}?options=-csearch_path%3Dtest`))

// Logic for prod DB URL
const finalProdDbUrl =
  prodDbUrl &&
  (prodDbUrl.includes('?')
    ? `${prodDbUrl}&options=-csearch_path%3Dpublic`
    : `${prodDbUrl}?options=-csearch_path%3Dpublic`)

// Generate random secrets (Always safe to recreate if missing)
const webhookSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
const schedulerSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')

console.log('\nStarting GCP operations...')

if (prodBotToken) await createSecret('telegram-bot-token', prodBotToken.trim())
if (finalProdDbUrl) await createSecret('database-url', finalProdDbUrl.trim())
if (testBotToken) await createSecret('telegram-bot-token-test', testBotToken.trim())
if (testDbUrl) await createSecret('database-url-test', testDbUrl.trim())
if (openaiKey) await createSecret('openai-api-key', openaiKey.trim())

// Create unique secrets per environment if missing
await createSecret('telegram-webhook-secret-test', webhookSecret)
await createSecret('scheduler-shared-secret-test', schedulerSecret)
await createSecret(
  'telegram-webhook-secret',
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
)
await createSecret(
  'scheduler-shared-secret',
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
)

console.log('\n--- Setup Complete! ---')
console.log('You can now run the import commands and then infra:apply:prod')
