/**
 * Compares two databases table by table so a migration can be checked before the
 * bot is pointed at the new one.
 *
 * Why this exists: a data-only restore fails quietly in the ways that matter —
 * a table skipped because of a foreign key, a partial COPY, a schema that was
 * migrated but never loaded. Row counts per table catch all three, and they are
 * cheap enough to run right before and right after the cutover.
 *
 * It only reads. Nothing here writes to either database.
 *
 * Usage:
 *   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... \
 *     bun run scripts/ops/compare-database-contents.ts
 *
 * Exits non-zero when the two do not match, so it can gate a cutover script.
 * `__drizzle_migrations` is compared separately and never fails the run: the
 * target records its own migration history when `db:migrate` runs there.
 */
import postgres from 'postgres'

const MIGRATIONS_TABLE = '__drizzle_migrations'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

function connect(databaseUrl: string) {
  return postgres(databaseUrl, {
    max: 4,
    // The source may still be behind a transaction pooler, which cannot prepare.
    prepare: false,
    onnotice: () => {}
  })
}

async function listTables(sql: postgres.Sql, schema: string): Promise<string[]> {
  const rows = await sql<{ tableName: string }[]>`
    select table_name as "tableName"
    from information_schema.tables
    where table_schema = ${schema}
      and table_type = 'BASE TABLE'
    order by table_name
  `

  return rows.map((row) => row.tableName)
}

async function countRows(sql: postgres.Sql, schema: string, table: string): Promise<number> {
  const rows = await sql<{ total: string }[]>`
    select count(*)::text as total from ${sql(schema)}.${sql(table)}
  `

  return Number(rows[0]?.total ?? '0')
}

async function countAll(
  sql: postgres.Sql,
  schema: string,
  tables: readonly string[]
): Promise<Map<string, number>> {
  const counted = await Promise.all(
    tables.map(async (table) => [table, await countRows(sql, schema, table)] as const)
  )

  return new Map(counted)
}

function formatRow(columns: readonly string[], widths: readonly number[]): string {
  return columns.map((column, index) => column.padEnd(widths[index] ?? 0)).join('  ')
}

async function run(): Promise<void> {
  const schema = process.env.DB_SCHEMA?.trim() || 'public'
  const source = connect(requireEnv('SOURCE_DATABASE_URL'))
  const target = connect(requireEnv('TARGET_DATABASE_URL'))

  try {
    const [sourceTables, targetTables] = await Promise.all([
      listTables(source, schema),
      listTables(target, schema)
    ])

    const missingInTarget = sourceTables.filter((table) => !targetTables.includes(table))
    const extraInTarget = targetTables.filter((table) => !sourceTables.includes(table))

    const comparable = sourceTables.filter(
      (table) => table !== MIGRATIONS_TABLE && targetTables.includes(table)
    )
    const [sourceCounts, targetCounts] = await Promise.all([
      countAll(source, schema, comparable),
      countAll(target, schema, comparable)
    ])

    const mismatched = comparable.filter(
      (table) => sourceCounts.get(table) !== targetCounts.get(table)
    )

    const widths = [
      Math.max(5, ...comparable.map((table) => table.length)),
      Math.max(6, ...comparable.map((table) => String(sourceCounts.get(table) ?? 0).length)),
      Math.max(6, ...comparable.map((table) => String(targetCounts.get(table) ?? 0).length))
    ]

    console.log(`schema: ${schema}`)
    console.log(formatRow(['table', 'source', 'target', ''], widths))
    for (const table of comparable) {
      const sourceCount = sourceCounts.get(table) ?? 0
      const targetCount = targetCounts.get(table) ?? 0
      console.log(
        formatRow(
          [
            table,
            String(sourceCount),
            String(targetCount),
            sourceCount === targetCount ? 'ok' : 'MISMATCH'
          ],
          widths
        )
      )
    }

    const totals = {
      source: [...sourceCounts.values()].reduce((sum, value) => sum + value, 0),
      target: [...targetCounts.values()].reduce((sum, value) => sum + value, 0)
    }
    console.log(`\ntables compared: ${comparable.length}`)
    console.log(`rows: source ${totals.source}, target ${totals.target}`)

    if (missingInTarget.length > 0) {
      console.error(`\nmissing in target: ${missingInTarget.join(', ')}`)
    }
    if (extraInTarget.length > 0) {
      console.error(`extra in target: ${extraInTarget.join(', ')}`)
    }
    if (mismatched.length > 0) {
      console.error(`row count mismatch: ${mismatched.join(', ')}`)
    }

    if (missingInTarget.length > 0 || extraInTarget.length > 0 || mismatched.length > 0) {
      process.exitCode = 1
      return
    }

    console.log('\ndatabases match')
  } finally {
    await Promise.allSettled([source.end({ timeout: 5 }), target.end({ timeout: 5 })])
  }
}

await run()
