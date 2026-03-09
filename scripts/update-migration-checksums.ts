import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const rootDir = process.cwd()
const migrationDir = path.join(rootDir, 'packages', 'db', 'drizzle')
const manifestPath = path.join(rootDir, 'packages', 'db', 'drizzle-checksums.json')

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

const files = (await readdir(migrationDir)).filter((entry) => entry.endsWith('.sql')).sort()

const manifest = {
  algorithm: 'sha256',
  files: {} as Record<string, string>
}

for (const file of files) {
  const sql = await readFile(path.join(migrationDir, file), 'utf8')
  manifest.files[file] = sha256(sql)
}

await writeFile(`${manifestPath}`, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Wrote checksums for ${files.length} migrations`)
