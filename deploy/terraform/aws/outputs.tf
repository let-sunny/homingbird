output "load_balancer_dns_name" {
  description = "Create a DNS record for the host in public_url that points here."
  value       = aws_lb.dovecote.dns_name
}

output "load_balancer_zone_id" {
  description = "Hosted zone of the load balancer, for a Route 53 alias record."
  value       = aws_lb.dovecote.zone_id
}

output "database_address" {
  description = "Host name of the PostgreSQL instance."
  value       = aws_db_instance.dovecote.address
}

output "log_group" {
  description = "CloudWatch log group that receives Dovecote's output."
  value       = aws_cloudwatch_log_group.dovecote.name
}

output "oidc_redirect_uri" {
  description = "Register this redirect URI with the identity provider."
  value       = "${var.public_url}/auth/callback"
}
