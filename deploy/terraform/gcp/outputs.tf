output "service_url" {
  description = "The run.app URL of the service. Map your own domain to it and use that as public_url."
  value       = google_cloud_run_v2_service.dovecote.uri
}

output "service_account" {
  description = "The identity Dovecote runs as."
  value       = google_service_account.dovecote.email
}

output "database_connection_name" {
  description = "Cloud SQL connection name, for cloud-sql-proxy and backups."
  value       = google_sql_database_instance.dovecote.connection_name
}

output "oidc_redirect_uri" {
  description = "Register this redirect URI with the identity provider."
  value       = "${var.public_url}/auth/callback"
}
