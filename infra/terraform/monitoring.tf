locals {
  monitoring_metric_prefix = replace(local.name_prefix, "-", "_")

  bot_error_metrics = {
    telegram_bot_error = {
      event        = "telegram.bot_error"
      metric_name  = "${local.monitoring_metric_prefix}_telegram_bot_error"
      display_name = "${local.name_prefix} Telegram bot error"
    }
    payment_ingest_failed = {
      event        = "payment.ingest_failed"
      metric_name  = "${local.monitoring_metric_prefix}_payment_ingest_failed"
      display_name = "${local.name_prefix} payment ingest failed"
    }
    purchase_ingest_failed = {
      event        = "purchase.ingest_failed"
      metric_name  = "${local.monitoring_metric_prefix}_purchase_ingest_failed"
      display_name = "${local.name_prefix} purchase ingest failed"
    }
    assistant_reply_failed = {
      event        = "assistant.reply_failed"
      metric_name  = "${local.monitoring_metric_prefix}_assistant_reply_failed"
      display_name = "${local.name_prefix} assistant reply failed"
    }
    reminder_dispatch_failed = {
      event        = "scheduler.reminder.dispatch_failed"
      metric_name  = "${local.monitoring_metric_prefix}_scheduler_reminder_dispatch_failed"
      display_name = "${local.name_prefix} reminder dispatch failed"
    }
  }
}

resource "google_monitoring_notification_channel" "email" {
  for_each = toset(var.alert_notification_emails)

  project      = var.project_id
  display_name = "${local.name_prefix} alerts ${each.value}"
  type         = "email"

  labels = {
    email_address = each.value
  }

  depends_on = [google_project_service.enabled]
}

resource "google_logging_metric" "bot_error_events" {
  for_each = local.bot_error_metrics

  project     = var.project_id
  name        = each.value.metric_name
  description = "Counts `${each.value.event}` log events for ${module.bot_api_service.name}."
  filter      = <<-EOT
resource.type="cloud_run_revision"
resource.labels.service_name="${module.bot_api_service.name}"
jsonPayload.event="${each.value.event}"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }

  depends_on = [google_project_service.enabled]
}

resource "google_monitoring_alert_policy" "bot_api_5xx" {
  project      = var.project_id
  display_name = "${local.name_prefix} bot API 5xx"
  combiner     = "OR"

  notification_channels = [
    for channel in google_monitoring_notification_channel.email : channel.name
  ]

  documentation {
    content   = "Cloud Run is returning 5xx responses for `${module.bot_api_service.name}` in `${var.environment}`."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Cloud Run 5xx responses"

    condition_threshold {
      filter = <<-EOT
resource.type="cloud_run_revision"
resource.labels.service_name="${module.bot_api_service.name}"
metric.type="run.googleapis.com/request_count"
metric.labels.response_code_class="5xx"
      EOT

      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.service_name"]
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.enabled]
}

resource "google_monitoring_alert_policy" "bot_error_events" {
  for_each = local.bot_error_metrics

  project      = var.project_id
  display_name = each.value.display_name
  combiner     = "OR"

  notification_channels = [
    for channel in google_monitoring_notification_channel.email : channel.name
  ]

  documentation {
    content   = "Structured bot failure event `${each.value.event}` was logged by `${module.bot_api_service.name}` in `${var.environment}`."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = each.value.display_name

    condition_threshold {
      filter = <<-EOT
resource.type="global"
metric.type="logging.googleapis.com/user/${google_logging_metric.bot_error_events[each.key].name}"
      EOT

      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_logging_metric.bot_error_events]
}
