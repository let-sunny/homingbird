terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  database_name = "homingbird"
  database_user = "homingbird"
  public_url    = "https://${var.domain}"

  environment = { for name, value in merge({
    HB_PUBLIC_URL           = local.public_url
    HB_OIDC_ISSUER          = var.oidc_issuer
    HB_OIDC_CLIENT_ID       = var.oidc_client_id
    HB_ALLOWED_DOMAINS      = join(",", var.allowed_domains)
    HB_ADMIN_EMAILS         = join(",", var.admin_emails)
    HB_CHANNELS               = join(",", var.channels)
    HB_CONTACT_MODE         = var.contact_mode
    HB_AUDIT_WEBHOOK_URL    = var.audit_webhook_url
    HB_AUDIT_RETENTION_DAYS = var.audit_retention_days == null ? "" : tostring(var.audit_retention_days)
    HB_TRUST_PROXY          = "2"
    HB_AUDIT_STDOUT         = "1"
  }, var.extra_environment) : name => value if value != "" }
}

resource "google_project_service" "required" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "compute.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "dovecote" {
  account_id   = "${var.name}-run"
  display_name = "Dovecote (Homingbird relay)"
}

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "dovecote" {
  name                = "${var.name}-postgres"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.deletion_protection
  depends_on          = [google_project_service.required]

  settings {
    tier              = var.database_tier
    availability_type = var.database_high_availability ? "REGIONAL" : "ZONAL"
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "18:00"
    }
  }
}

resource "google_sql_database" "dovecote" {
  name     = local.database_name
  instance = google_sql_database_instance.dovecote.name
}

resource "google_sql_user" "dovecote" {
  name     = local.database_user
  instance = google_sql_database_instance.dovecote.name
  password = random_password.database.result
}

resource "google_secret_manager_secret" "database_url" {
  secret_id  = "${var.name}-database-url"
  depends_on = [google_project_service.required]

  replication {
    auto {}
  }
}

# Cloud Run mounts the instance's Unix socket under /cloudsql, so the URL names the socket as the host.
resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgres://${local.database_user}:${random_password.database.result}@/${local.database_name}?host=/cloudsql/${google_sql_database_instance.dovecote.connection_name}"
}

resource "google_secret_manager_secret" "oidc_client_secret" {
  secret_id  = "${var.name}-oidc-client-secret"
  depends_on = [google_project_service.required]

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "oidc_client_secret" {
  secret      = google_secret_manager_secret.oidc_client_secret.id
  secret_data = var.oidc_client_secret
}

resource "google_secret_manager_secret_iam_member" "database_url" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.dovecote.email}"
}

resource "google_secret_manager_secret_iam_member" "oidc_client_secret" {
  secret_id = google_secret_manager_secret.oidc_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.dovecote.email}"
}

resource "google_project_iam_member" "cloud_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.dovecote.email}"
}

resource "google_cloud_run_v2_service" "dovecote" {
  name                = var.name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = var.deletion_protection

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.oidc_client_secret,
    google_secret_manager_secret_iam_member.database_url,
    google_secret_manager_secret_iam_member.oidc_client_secret,
    google_project_iam_member.cloud_sql_client,
  ]

  template {
    service_account = google_service_account.dovecote.email

    # Live delivery fans out inside one process: a second instance would not see the first one's notes.
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    # Event streams are single long requests; 3600 seconds is the most Cloud Run allows.
    timeout                          = "3600s"
    max_instance_request_concurrency = 1000

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.dovecote.connection_name]
      }
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # CPU stays allocated between requests: open streams and timers need it.
        cpu_idle          = false
        startup_cpu_boost = true
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = local.environment
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name = "HB_OIDC_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.oidc_client_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "HB_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        period_seconds    = 2
        failure_threshold = 30
      }

      liveness_probe {
        http_get {
          path = "/healthz"
        }
        period_seconds = 30
      }
    }
  }
}

# Dovecote authenticates every request itself; the service must be reachable without a Google identity.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.dovecote.name
  location = google_cloud_run_v2_service.dovecote.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_compute_region_network_endpoint_group" "dovecote" {
  name                  = "${var.name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.dovecote.name
  }
}

resource "google_compute_backend_service" "dovecote" {
  name                  = "${var.name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"

  backend {
    group = google_compute_region_network_endpoint_group.dovecote.id
  }
}

resource "google_compute_url_map" "dovecote" {
  name            = "${var.name}-urls"
  default_service = google_compute_backend_service.dovecote.id
}

resource "google_compute_managed_ssl_certificate" "dovecote" {
  name = "${var.name}-certificate"

  managed {
    domains = [var.domain]
  }
}

resource "google_compute_target_https_proxy" "dovecote" {
  name             = "${var.name}-https"
  url_map          = google_compute_url_map.dovecote.id
  ssl_certificates = [google_compute_managed_ssl_certificate.dovecote.id]
}

resource "google_compute_global_address" "dovecote" {
  name = "${var.name}-address"
}

resource "google_compute_global_forwarding_rule" "dovecote" {
  name                  = "${var.name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_https_proxy.dovecote.id
  ip_address            = google_compute_global_address.dovecote.id
  port_range            = "443"
}
