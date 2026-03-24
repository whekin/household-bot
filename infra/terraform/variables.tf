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

variable "bot_purchase_parser_model" {
  description = "Optional PURCHASE_PARSER_MODEL override for bot runtime"
  type        = string
  default     = null
  nullable    = true
}

variable "bot_assistant_model" {
  description = "Optional ASSISTANT_MODEL override for bot runtime"
  type        = string
  default     = null
  nullable    = true
}

variable "bot_topic_processor_model" {
  description = "Optional TOPIC_PROCESSOR_MODEL override for bot runtime"
  type        = string
  default     = null
  nullable    = true
}

variable "bot_topic_processor_timeout_ms" {
  description = "Optional TOPIC_PROCESSOR_TIMEOUT_MS override for bot runtime"
  type        = number
  default     = null
  nullable    = true
}

variable "bot_assistant_timeout_ms" {
  description = "Optional ASSISTANT_TIMEOUT_MS override for bot runtime"
  type        = number
  default     = null
  nullable    = true
}

variable "bot_assistant_memory_max_turns" {
  description = "Optional ASSISTANT_MEMORY_MAX_TURNS override for bot runtime"
  type        = number
  default     = null
  nullable    = true
}

variable "bot_assistant_rate_limit_burst" {
  description = "Optional ASSISTANT_RATE_LIMIT_BURST override for bot runtime"
  type        = number
  default     = null
  nullable    = true
}

variable "bot_assistant_rate_limit_burst_window_ms" {
  description = "Optional ASSISTANT_RATE_LIMIT_BURST_WINDOW_MS override for bot runtime"
  type        = number
  default     = null
  nullable    = true
}

variable "bot_assistant_rate_limit_rolling" {
  description = "Optional ASSISTANT_RATE_LIMIT_ROLLING override for bot runtime"
  type        = number
  default     = null
  nullable    = true
}

variable "bot_assistant_rate_limit_rolling_window_ms" {
  description = "Optional ASSISTANT_RATE_LIMIT_ROLLING_WINDOW_MS override for bot runtime"
  type        = number
  default     = null
  nullable    = true
}

variable "bot_mini_app_url" {
  description = "Optional URL for /app and /dashboard bot commands"
  type        = string
  default     = null
  nullable    = true
}

variable "bot_mini_app_allowed_origins" {
  description = "Optional allow-list of mini app origins for bot CORS handling"
  type        = list(string)
  default     = []
}

variable "alert_notification_emails" {
  description = "Email addresses that should receive bot monitoring alerts"
  type        = list(string)
  default     = []
}

variable "openai_api_key_secret_id" {
  description = "Optional Secret Manager ID for OPENAI_API_KEY"
  type        = string
  default     = null
  nullable    = true
}

variable "scheduled_dispatch_queue_name" {
  description = "Cloud Tasks queue name for one-shot reminder dispatches"
  type        = string
  default     = "scheduled-dispatches"
}

variable "scheduled_dispatch_public_base_url" {
  description = "Public bot base URL used by Cloud Tasks callbacks for scheduled dispatches"
  type        = string
  default     = null
  nullable    = true
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

variable "manage_runtime_secrets" {
  description = "Whether Terraform should manage the creation of runtime secrets (disable if secrets are created manually)"
  type        = bool
  default     = true
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

variable "db_schema" {
  description = "Database schema name for the application"
  type        = string
  default     = "public"
}
