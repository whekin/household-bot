import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

interface ChecksumManifest {
  algorithm: string
  files: Record<string, string>
}

const rootDir = process.cwd()
const migrationDir = path.join(rootDir, 'packages', 'db', 'drizzle')
const manifestPath = path.join(rootDir, 'packages', 'db', 'drizzle-checksums.json')

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ChecksumManifest

  if (manifest.algorithm !== 'sha256') {
    throw new Error(`Unsupported migration checksum algorithm: ${manifest.algorithm}`)
  }

  const files = (await readdir(migrationDir)).filter((entry) => entry.endsWith('.sql')).sort()

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
