import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config()
const awsConfig = new pulumi.Config('aws')

const appName = config.get('appName') ?? 'household'
const environment = config.get('environment') ?? pulumi.getStack()
const tags = {
  Project: appName,
  Environment: environment,
  ManagedBy: 'Pulumi'
}

const publicApiHostname = config.require('publicApiHostname')
const publicMiniappHostname = config.require('publicMiniappHostname')
const miniAppAllowedOrigins = config.getObject<string[]>('miniAppAllowedOrigins') ?? [
  `https://${publicMiniappHostname}`
]
const miniAppUrl = config.get('miniAppUrl') ?? `https://${publicMiniappHostname}`
const logLevel = config.get('logLevel') ?? 'info'
const purchaseParserModel = config.get('purchaseParserModel') ?? 'gpt-4o-mini'
const assistantModel = config.get('assistantModel') ?? 'gpt-4o-mini'
const topicProcessorModel = config.get('topicProcessorModel') ?? 'gpt-4o-mini'

const telegramBotToken = config.requireSecret('telegramBotToken')
const telegramWebhookSecret = config.requireSecret('telegramWebhookSecret')
const databaseUrl = config.getSecret('databaseUrl')
const schedulerSharedSecret = config.getSecret('schedulerSharedSecret')
const openaiApiKey = config.getSecret('openaiApiKey')

const ecrRepository = new aws.ecr.Repository(`${appName}-${environment}-bot`, {
  forceDelete: true,
  imageTagMutability: 'MUTABLE',
  imageScanningConfiguration: {
    scanOnPush: true
  },
  tags
})

const botImage = new awsx.ecr.Image(`${appName}-${environment}-bot-image`, {
  repositoryUrl: ecrRepository.repositoryUrl,
  context: '../../../',
  dockerfile: '../../../apps/bot/Dockerfile.lambda',
  platform: 'linux/amd64'
})

const lambdaRole = new aws.iam.Role(`${appName}-${environment}-lambda-role`, {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'lambda.amazonaws.com'
  }),
  tags
})

new aws.iam.RolePolicyAttachment(`${appName}-${environment}-lambda-basic-exec`, {
  role: lambdaRole.name,
  policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
})

const secretSpecs = [
  {
    key: 'telegramBotToken',
    name: `${appName}/${environment}/telegram-bot-token`,
    description: 'Telegram bot token for the household bot runtime',
    value: telegramBotToken
  },
  {
    key: 'telegramWebhookSecret',
    name: `${appName}/${environment}/telegram-webhook-secret`,
    description: 'Telegram webhook secret for the household bot runtime',
    value: telegramWebhookSecret
  },
  {
    key: 'databaseUrl',
    name: `${appName}/${environment}/database-url`,
    description: 'Database URL for the household bot runtime',
    value: databaseUrl
  },
  {
    key: 'schedulerSharedSecret',
    name: `${appName}/${environment}/scheduler-shared-secret`,
    description: 'Shared secret used by Supabase Cron reminder calls',
    value: schedulerSharedSecret
  },
  {
    key: 'openaiApiKey',
    name: `${appName}/${environment}/openai-api-key`,
    description: 'OpenAI API key for assistant and parsing features',
    value: openaiApiKey
  }
] as const

const secrets = Object.fromEntries(
  secretSpecs.map(({ key, name, description, value }) => {
    const secret = new aws.secretsmanager.Secret(`${appName}-${environment}-${key}`, {
      name,
      description,
      recoveryWindowInDays: 0,
      tags
    })

    if (value) {
      new aws.secretsmanager.SecretVersion(`${appName}-${environment}-${key}-version`, {
        secretId: secret.id,
        secretString: value
      })
    }

    return [key, secret]
  })
) as Record<(typeof secretSpecs)[number]['key'], aws.secretsmanager.Secret>

const bucket = new aws.s3.BucketV2(`${appName}-${environment}-miniapp`, {
  bucket: `${appName}-${environment}-miniapp`,
  tags
})

new aws.s3.BucketOwnershipControls(`${appName}-${environment}-miniapp-ownership`, {
  bucket: bucket.id,
  rule: {
    objectOwnership: 'BucketOwnerPreferred'
  }
})

new aws.s3.BucketPublicAccessBlock(`${appName}-${environment}-miniapp-public-access`, {
  bucket: bucket.id,
  blockPublicAcls: false,
  blockPublicPolicy: false,
  ignorePublicAcls: false,
  restrictPublicBuckets: false
})

new aws.s3.BucketWebsiteConfigurationV2(`${appName}-${environment}-miniapp-website`, {
  bucket: bucket.id,
  indexDocument: {
    suffix: 'index.html'
  },
  errorDocument: {
    key: 'index.html'
  }
})

new aws.s3.BucketPolicy(`${appName}-${environment}-miniapp-policy`, {
  bucket: bucket.id,
  policy: bucket.arn.apply((bucketArn) =>
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowPublicRead',
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: `${bucketArn}/*`
        }
      ]
    })
  )
})

const lambda = new aws.lambda.Function(`${appName}-${environment}-bot`, {
  packageType: 'Image',
  imageUri: botImage.imageUri,
  role: lambdaRole.arn,
  memorySize: config.getNumber('memorySize') ?? 1024,
  timeout: config.getNumber('timeout') ?? 30,
  architectures: ['x86_64'],
  environment: {
    variables: {
      NODE_ENV: 'production',
      LOG_LEVEL: logLevel,
      TELEGRAM_BOT_TOKEN: telegramBotToken,
      TELEGRAM_WEBHOOK_SECRET: telegramWebhookSecret,
      TELEGRAM_WEBHOOK_PATH: config.get('telegramWebhookPath') ?? '/webhook/telegram',
      DATABASE_URL: databaseUrl ?? '',
      SCHEDULER_SHARED_SECRET: schedulerSharedSecret ?? '',
      OPENAI_API_KEY: openaiApiKey ?? '',
      MINI_APP_URL: miniAppUrl,
      MINI_APP_ALLOWED_ORIGINS: miniAppAllowedOrigins.join(','),
      PURCHASE_PARSER_MODEL: purchaseParserModel,
      ASSISTANT_MODEL: assistantModel,
      TOPIC_PROCESSOR_MODEL: topicProcessorModel
    }
  },
  tags
})

const functionUrl = new aws.lambda.FunctionUrl(`${appName}-${environment}-bot-url`, {
  functionName: lambda.name,
  authorizationType: 'NONE',
  cors: {
    allowCredentials: false,
    allowHeaders: ['*'],
    allowMethods: ['*'],
    allowOrigins: miniAppAllowedOrigins,
    exposeHeaders: ['*'],
    maxAge: 300
  }
})

const region = awsConfig.get('region') || aws.getRegionOutput().name

export const botOriginUrl = functionUrl.functionUrl
export const miniAppBucketName = bucket.bucket
export const miniAppWebsiteUrl = pulumi.interpolate`http://${bucket.websiteEndpoint}`
export const cloudflareApiCnameTarget = pulumi
  .output(functionUrl.functionUrl)
  .apply((url) => new URL(url).hostname)
export const cloudflareMiniappCnameTarget = bucket.websiteEndpoint
export const publicApiHostnameOutput = publicApiHostname
export const publicMiniappHostnameOutput = publicMiniappHostname
export const awsRegion = region
export const ecrRepositoryUrl = ecrRepository.repositoryUrl
export const secretIds = {
  telegramBotToken: secrets.telegramBotToken.id,
  telegramWebhookSecret: secrets.telegramWebhookSecret.id,
  databaseUrl: secrets.databaseUrl.id,
  schedulerSharedSecret: secrets.schedulerSharedSecret.id,
  openaiApiKey: secrets.openaiApiKey.id
}
