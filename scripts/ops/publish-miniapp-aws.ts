import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const bucket = process.env.AWS_MINIAPP_BUCKET
const botApiUrl = process.env.BOT_API_URL
const awsRegion = process.env.AWS_REGION
const dryRun = process.env.AWS_PUBLISH_DRY_RUN === 'true'

if (!bucket) {
  throw new Error('AWS_MINIAPP_BUCKET environment variable is required')
}

if (!botApiUrl) {
  throw new Error('BOT_API_URL environment variable is required')
}

await Bun.$`bun run --filter @household/miniapp build`

const distDir = join(process.cwd(), 'apps/miniapp/dist')
const templatePath = join(process.cwd(), 'apps/miniapp/config.template.js')
const stagingDir = await mkdtemp(join(tmpdir(), 'household-miniapp-'))

try {
  await Bun.$`cp -R ${distDir}/. ${stagingDir}`

  const template = await Bun.file(templatePath).text()
  const configScript = template.replace('${BOT_API_URL}', botApiUrl)
  await Bun.write(join(stagingDir, 'config.js'), configScript)

  const regionArgs = awsRegion ? ['--region', awsRegion] : []
  const syncArgs = dryRun ? ['--dryrun'] : []

  await Bun.$`aws s3 sync ${stagingDir} s3://${bucket} --delete --exclude index.html --exclude config.js --cache-control public,max-age=31536000,immutable ${regionArgs} ${syncArgs}`
  await Bun.$`aws s3 cp ${join(stagingDir, 'index.html')} s3://${bucket}/index.html --cache-control no-cache ${regionArgs} ${syncArgs}`
  await Bun.$`aws s3 cp ${join(stagingDir, 'config.js')} s3://${bucket}/config.js --cache-control no-cache ${regionArgs} ${syncArgs}`
} finally {
  await rm(stagingDir, {
    recursive: true,
    force: true
  })
}
