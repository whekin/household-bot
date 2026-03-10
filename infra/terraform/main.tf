data "google_project" "current" {
  project_id = var.project_id
}

resource "google_project_service" "enabled" {
  for_each                   = local.api_services
  project                    = var.project_id
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = false
}

resource "google_artifact_registry_repository" "containers" {
  location      = local.artifact_location
  project       = var.project_id
  repository_id = var.artifact_repository_id
  description   = "Container images for household bot"
  format        = "DOCKER"

  labels = local.common_labels

  depends_on = [google_project_service.enabled]
}

resource "google_service_account" "bot_runtime" {
  project      = var.project_id
  account_id   = "${var.environment}-bot-runtime"
  display_name = "${local.name_prefix} bot runtime"
}

resource "google_service_account" "mini_runtime" {
  project      = var.project_id
  account_id   = "${var.environment}-mini-runtime"
  display_name = "${local.name_prefix} mini runtime"
}

resource "google_service_account" "scheduler_invoker" {
  project      = var.project_id
  account_id   = "${var.environment}-scheduler"
  display_name = "${local.name_prefix} scheduler invoker"
}

resource "google_secret_manager_secret" "runtime" {
  for_each = local.runtime_secret_ids

  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  labels = local.common_labels

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_iam_member" "bot_runtime_access" {
  for_each = google_secret_manager_secret.runtime

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.bot_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "github_deployer_bot_token_access" {
  count = var.create_workload_identity ? 1 : 0

  project   = var.project_id
  secret_id = var.telegram_bot_token_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.github_deployer[0].email}"
}

module "bot_api_service" {
  source = "./modules/cloud_run_service"

  project_id            = var.project_id
  region                = var.region
  name                  = "${local.name_prefix}-bot-api"
  service_account_email = google_service_account.bot_runtime.email
  image                 = var.bot_api_image
  allow_unauthenticated = true
  min_instance_count    = var.bot_min_instances
  max_instance_count    = var.bot_max_instances
  labels                = local.common_labels

  env = merge(
    {
      NODE_ENV = var.environment
    },
    var.bot_parser_model == null ? {} : {
      PARSER_MODEL = var.bot_parser_model
    },
    length(var.bot_mini_app_allowed_origins) == 0 ? {} : {
      MINI_APP_ALLOWED_ORIGINS = join(",", var.bot_mini_app_allowed_origins)
    },
    {
      SCHEDULER_OIDC_ALLOWED_EMAILS = google_service_account.scheduler_invoker.email
    }
  )

  secret_env = merge(
    {
      TELEGRAM_WEBHOOK_SECRET = var.telegram_webhook_secret_id
      SCHEDULER_SHARED_SECRET = var.scheduler_shared_secret_id
    },
    var.database_url_secret_id == null ? {} : {
      DATABASE_URL = var.database_url_secret_id
    },
    var.telegram_bot_token_secret_id == null ? {} : {
      TELEGRAM_BOT_TOKEN = var.telegram_bot_token_secret_id
    },
    var.openai_api_key_secret_id == null ? {} : {
      OPENAI_API_KEY = var.openai_api_key_secret_id
    }
  )

  depends_on = [
    google_project_service.enabled,
    google_secret_manager_secret.runtime,
    google_secret_manager_secret_iam_member.bot_runtime_access
  ]
}

module "mini_app_service" {
  source = "./modules/cloud_run_service"

  project_id            = var.project_id
  region                = var.region
  name                  = "${local.name_prefix}-mini-app"
  service_account_email = google_service_account.mini_runtime.email
  image                 = var.mini_app_image
  allow_unauthenticated = true
  min_instance_count    = var.mini_min_instances
  max_instance_count    = var.mini_max_instances
  labels                = local.common_labels

  env = {
    NODE_ENV    = var.environment
    BOT_API_URL = module.bot_api_service.uri
  }

  depends_on = [google_project_service.enabled]
}

resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  project  = var.project_id
  location = var.region
  name     = module.bot_api_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler_invoker.email}"
}

resource "google_service_account_iam_member" "scheduler_token_creator" {
  service_account_id = google_service_account.scheduler_invoker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
}

resource "google_cloud_scheduler_job" "reminders" {
  for_each = local.reminder_jobs

  project   = var.project_id
  region    = var.region
  name      = "${local.name_prefix}-${each.key}"
  schedule  = each.value.schedule
  time_zone = var.scheduler_timezone
  paused    = var.scheduler_paused

  http_target {
    uri         = "${module.bot_api_service.uri}${each.value.path}"
    http_method = "POST"

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({
      dryRun = var.scheduler_dry_run
      jobId  = "${local.name_prefix}-${each.key}"
    }))

    oidc_token {
      service_account_email = google_service_account.scheduler_invoker.email
      audience              = module.bot_api_service.uri
    }
  }

  depends_on = [
    module.bot_api_service,
    google_service_account_iam_member.scheduler_token_creator
  ]
}

resource "google_service_account" "github_deployer" {
  count = var.create_workload_identity ? 1 : 0

  project      = var.project_id
  account_id   = var.github_deploy_service_account_id
  display_name = "${local.name_prefix} GitHub deployer"
}

resource "google_iam_workload_identity_pool" "github" {
  count = var.create_workload_identity ? 1 : 0

  project                   = var.project_id
  workload_identity_pool_id = var.workload_identity_pool_id
  display_name              = "GitHub Actions Pool"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  count = var.create_workload_identity ? 1 : 0

  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[0].workload_identity_pool_id
  workload_identity_pool_provider_id = var.workload_identity_provider_id
  display_name                       = "GitHub Actions Provider"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_oidc" {
  count = var.create_workload_identity ? 1 : 0

  service_account_id = google_service_account.github_deployer[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[0].name}/attribute.repository/${var.github_repository}"
}

resource "google_project_iam_member" "github_deployer_roles" {
  for_each = var.create_workload_identity ? local.github_deploy_roles : toset([])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.github_deployer[0].email}"
}
