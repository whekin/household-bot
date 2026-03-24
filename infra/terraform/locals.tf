locals {
  name_prefix = "${var.service_prefix}-${var.environment}"

  common_labels = merge(
    {
      environment = var.environment
      managed_by  = "terraform"
      project     = "household-bot"
    },
    var.labels
  )

  artifact_location = coalesce(var.artifact_repository_location, var.region)

  runtime_secret_ids = toset(compact([
    var.telegram_webhook_secret_id,
    var.scheduler_shared_secret_id,
    var.database_url_secret_id,
    var.telegram_bot_token_secret_id,
    var.openai_api_key_secret_id
  ]))

  api_services = toset([
    "artifactregistry.googleapis.com",
    "cloudtasks.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sts.googleapis.com"
  ])

  github_deploy_roles = toset([
    "roles/artifactregistry.writer",
    "roles/iam.serviceAccountUser",
    "roles/run.admin"
  ])
}
