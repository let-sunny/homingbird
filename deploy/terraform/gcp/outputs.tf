output "load_balancer_address" {
  description = "Point the A record of the domain here."
  value       = google_compute_global_address.dovecote.address
}

output "public_url" {
  description = "HB_PUBLIC_URL as configured."
  value       = local.public_url
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
  value       = "${local.public_url}/auth/callback"
}
