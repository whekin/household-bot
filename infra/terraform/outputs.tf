output "artifact_repository" {
  description = "Artifact Registry repository"
  value       = google_artifact_registry_repository.containers.id
}

output "bot_api_service_name" {
  description = "Cloud Run bot API service name"
  value       = module.bot_api_service.name
}

output "bot_api_service_url" {
  description = "Cloud Run bot API URL"
  value       = module.bot_api_service.uri
}

output "mini_app_service_name" {
  description = "Cloud Run mini app service name"
  value       = module.mini_app_service.name
}

output "mini_app_service_url" {
  description = "Cloud Run mini app URL"
  value       = module.mini_app_service.uri
}

output "runtime_secret_ids" {
  description = "Secret Manager IDs expected by runtime"
  value       = sort([for secret in google_secret_manager_secret.runtime : secret.secret_id])
}

output "github_deployer_service_account" {
  description = "GitHub OIDC deployer service account email"
  value       = var.create_workload_identity ? google_service_account.github_deployer[0].email : null
}

output "github_workload_identity_provider" {
  description = "Full Workload Identity Provider resource name"
  value       = var.create_workload_identity ? google_iam_workload_identity_pool_provider.github[0].name : null
}
