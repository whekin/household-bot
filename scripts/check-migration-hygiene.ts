import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

interface ChecksumManifest {
  algorithm: string
  files: Record<string, string>
}

interface MigrationJournal {
  entries: Array<{
    idx: number
    tag: string
  }>
}

const rootDir = process.cwd()
const migrationDir = path.join(rootDir, 'packages', 'db', 'drizzle')
const manifestPath = path.join(rootDir, 'packages', 'db', 'drizzle-checksums.json')
const journalPath = path.join(rootDir, 'packages', 'db', 'drizzle', 'meta', '_journal.json')

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ChecksumManifest
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as MigrationJournal

  if (manifest.algorithm !== 'sha256') {
    throw new Error(`Unsupported migration checksum algorithm: ${manifest.algorithm}`)
  }

  const files = (await readdir(migrationDir)).filter((entry) => entry.endsWith('.sql')).sort()
  const expectedTags = files.map((file) => file.replace(/\.sql$/, ''))
  const journalTags = journal.entries.map((entry) => entry.tag)

  const missingFromDisk = Object.keys(manifest.files).filter((file) => !files.includes(file))
  if (missingFromDisk.length > 0) {
    throw new Error(`Missing committed migration files: ${missingFromDisk.join(', ')}`)
  }

  const unexpectedFiles = files.filter((file) => !(file in manifest.files))
  if (unexpectedFiles.length > 0) {
    throw new Error(
      `New migrations must update packages/db/drizzle-checksums.json: ${unexpectedFiles.join(', ')}`
    )
  }

  const missingFromJournal = expectedTags.filter((tag) => !journalTags.includes(tag))
  if (missingFromJournal.length > 0) {
    throw new Error(
      `Migration journal is missing SQL files: ${missingFromJournal.map((tag) => `${tag}.sql`).join(', ')}`
    )
  }

  const unexpectedJournalEntries = journalTags.filter((tag) => !expectedTags.includes(tag))
  if (unexpectedJournalEntries.length > 0) {
    throw new Error(
      `Migration journal references missing SQL files: ${unexpectedJournalEntries.join(', ')}`
    )
  }

  const duplicateJournalTags = [
    ...new Set(journalTags.filter((tag, index) => journalTags.indexOf(tag) !== index))
  ]
  if (duplicateJournalTags.length > 0) {
    throw new Error(`Migration journal has duplicate tags: ${duplicateJournalTags.join(', ')}`)
  }

  const changedFiles: string[] = []

  for (const file of files) {
    const sql = await readFile(path.join(migrationDir, file), 'utf8')
    const actual = sha256(sql)
    if (actual !== manifest.files[file]) {
      changedFiles.push(file)
    }
  }

  if (changedFiles.length > 0) {
    throw new Error(`Historical migration files changed: ${changedFiles.join(', ')}`)
  }

  console.log(`Verified ${files.length} migration checksums`)
}

await main()
