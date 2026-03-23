const repositoryUrl = process.env.AWS_ECR_REPOSITORY_URL
const imageTag = process.env.AWS_ECR_IMAGE_TAG ?? 'latest'
const awsRegion = process.env.AWS_REGION

if (!repositoryUrl) {
  throw new Error('AWS_ECR_REPOSITORY_URL environment variable is required')
}

if (!awsRegion) {
  throw new Error('AWS_REGION environment variable is required')
}

const imageRef = `${repositoryUrl}:${imageTag}`

const passwordProcess = Bun.spawnSync(['aws', 'ecr', 'get-login-password', '--region', awsRegion], {
  stdout: 'pipe',
  stderr: 'inherit'
})

if (passwordProcess.exitCode !== 0) {
  throw new Error('Failed to obtain an ECR login password')
}

const loginProcess = Bun.spawnSync(
  ['docker', 'login', '--username', 'AWS', '--password-stdin', repositoryUrl.split('/')[0]!],
  {
    stdin: passwordProcess.stdout,
    stdout: 'inherit',
    stderr: 'inherit'
  }
)

if (loginProcess.exitCode !== 0) {
  throw new Error('Failed to login to ECR')
}

await Bun.$`docker build -f apps/bot/Dockerfile.lambda -t ${imageRef} .`
await Bun.$`docker push ${imageRef}`
