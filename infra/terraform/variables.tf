variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "Primary GCP region for Cloud Run services"
  type        = string
  default     = "europe-west1"
}

variable "environment" {
  description = "Environment name (e.g. dev, prod)"
  type        = string
  default     = "dev"
}

variable "service_prefix" {
  description = "Prefix for service names"
  type        = string
  default     = "household"
}

variable "artifact_repository_id" {
  description = "Artifact Registry repository ID"
  type        = string
  default     = "household-bot"
}

variable "artifact_repository_location" {
  description = "Artifact Registry location (defaults to region)"
  type        = string
  default     = null
  nullable    = true
}

variable "bot_api_image" {
  description = "Container image for bot API service"
  type        = string
}

variable "mini_app_image" {
  description = "Container image for mini app service"
  type        = string
}

variable "telegram_webhook_secret_id" {
  description = "Secret Manager ID for Telegram webhook secret token"
  type        = string
  default     = "telegram-webhook-secret"
}

variable "scheduler_shared_secret_id" {
  description = "Secret Manager ID for app-level scheduler secret"
  type        = string
  default     = "scheduler-shared-secret"
}

variable "supabase_url_secret_id" {
  description = "Optional Secret Manager ID for SUPABASE_URL"
  type        = string
  default     = null
  nullable    = true
}

variable "supabase_publishable_key_secret_id" {
  description = "Optional Secret Manager ID for SUPABASE_PUBLISHABLE_KEY"
  type        = string
  default     = null
  nullable    = true
}

variable "database_url_secret_id" {
  description = "Optional Secret Manager ID for DATABASE_URL"
  type        = string
  default     = null
  nullable    = true
}

variable "telegram_bot_token_secret_id" {
  description = "Secret Manager ID for TELEGRAM_BOT_TOKEN"
  type        = string
  default     = "telegram-bot-token"
}

variable "bot_household_id" {
  description = "Optional HOUSEHOLD_ID value for bot runtime"
  type        = string
  default     = null
  nullable    = true
}

variable "bot_household_chat_id" {
  description = "Optional TELEGRAM_HOUSEHOLD_CHAT_ID value for bot runtime"
  type        = string
  default     = null
  nullable    = true
}

variable "bot_purchase_topic_id" {
  description = "Optional TELEGRAM_PURCHASE_TOPIC_ID value for bot runtime"
  type        = number
  default     = null
  nullable    = true
}

variable "bot_parser_model" {
  description = "Optional PARSER_MODEL override for bot runtime"
  type        = string
  default     = null
  nullable    = true
}

variable "bot_mini_app_allowed_origins" {
  description = "Optional allow-list of mini app origins for bot CORS handling"
  type        = list(string)
  default     = []
}

variable "openai_api_key_secret_id" {
  description = "Optional Secret Manager ID for OPENAI_API_KEY"
  type        = string
  default     = null
  nullable    = true
}

variable "scheduler_timezone" {
  description = "Scheduler timezone"
  type        = string
  default     = "Asia/Tbilisi"
}

variable "scheduler_utilities_cron" {
  description = "Cron expression for the utilities reminder scheduler job"
  type        = string
  default     = "0 9 4 * *"
}

variable "scheduler_rent_warning_cron" {
  description = "Cron expression for the rent warning scheduler job"
  type        = string
  default     = "0 9 17 * *"
}

variable "scheduler_rent_due_cron" {
  description = "Cron expression for the rent due scheduler job"
  type        = string
  default     = "0 9 20 * *"
}

variable "scheduler_dry_run" {
  description = "Whether scheduler jobs should invoke the bot in dry-run mode"
  type        = bool
  default     = true
}

variable "scheduler_paused" {
  description = "Whether scheduler should be paused initially"
  type        = bool
  default     = true
}

variable "bot_min_instances" {
  description = "Minimum bot API instances"
  type        = number
  default     = 0
}

variable "bot_max_instances" {
  description = "Maximum bot API instances"
  type        = number
  default     = 3
}

variable "mini_min_instances" {
  description = "Minimum mini app instances"
  type        = number
  default     = 0
}

variable "mini_max_instances" {
  description = "Maximum mini app instances"
  type        = number
  default     = 2
}

variable "labels" {
  description = "Additional labels"
  type        = map(string)
  default     = {}
}

variable "create_workload_identity" {
  description = "Create GitHub OIDC Workload Identity resources"
  type        = bool
  default     = false
}

variable "github_repository" {
  description = "GitHub repository in owner/repo format"
  type        = string
  default     = "whekin/household-bot"
}

variable "workload_identity_pool_id" {
  description = "Workload Identity Pool ID"
  type        = string
  default     = "github-pool"
}

variable "workload_identity_provider_id" {
  description = "Workload Identity Provider ID"
  type        = string
  default     = "github-provider"
}

variable "github_deploy_service_account_id" {
  description = "Service account ID used by GitHub Actions via OIDC"
  type        = string
  default     = "github-deployer"
}
