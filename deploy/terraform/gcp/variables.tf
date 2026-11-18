variable "project_id" {
  description = "Google Cloud project to deploy into."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run and Cloud SQL."
  type        = string
  default     = "us-central1"
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "dovecote"
}

variable "image" {
  description = "Container image of Dovecote in a registry Cloud Run can pull from, such as Artifact Registry."
  type        = string
}

variable "domain" {
  description = "Domain name people and agents use to reach Dovecote, such as homingbird.example.com. Point its A record at the load_balancer_address output; the certificate is issued once it resolves."
  type        = string
}

variable "oidc_issuer" {
  description = "OpenID Connect issuer used for sign-in."
  type        = string
  default     = "https://accounts.google.com"
}

variable "oidc_client_id" {
  description = "OAuth client id registered with the issuer. Its redirect URI is https://<domain>/auth/callback."
  type        = string
}

variable "oidc_client_secret" {
  description = "OAuth client secret. Stored in Secret Manager; also ends up in the Terraform state."
  type        = string
  sensitive   = true
}

variable "allowed_domains" {
  description = "Email domains whose members may sign in."
  type        = list(string)
}

variable "admin_emails" {
  description = "Email addresses of the administrators. At least one is required."
  type        = list(string)

  validation {
    condition     = length(var.admin_emails) > 0
    error_message = "Name at least one administrator."
  }
}

variable "cpu" {
  description = "CPU limit of the single Dovecote instance. See docs/deployment.md for sizing."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory limit of the single Dovecote instance."
  type        = string
  default     = "1Gi"
}

variable "database_tier" {
  description = "Cloud SQL machine tier."
  type        = string
  default     = "db-custom-1-3840"
}

variable "database_high_availability" {
  description = "Run Cloud SQL with a standby in a second zone."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Refuse to destroy the service and the database."
  type        = bool
  default     = true
}

variable "topics" {
  description = "HB_TOPICS: topics to create on first start, as \"slug\" or \"slug: description\". general always exists."
  type        = list(string)
  default     = []
}

variable "contact_mode" {
  description = "HB_CONTACT_MODE until an administrator changes it: open, or contacts to require an accepted request first."
  type        = string
  default     = "open"

  validation {
    condition     = contains(["open", "contacts"], var.contact_mode)
    error_message = "contact_mode is open or contacts."
  }
}

variable "audit_webhook_url" {
  description = "HB_AUDIT_WEBHOOK_URL: where to POST audit entries, which contain note content. Empty for none."
  type        = string
  default     = ""
}

variable "audit_retention_days" {
  description = "HB_AUDIT_RETENTION_DAYS until an administrator changes it. null keeps audit entries forever."
  type        = number
  default     = null
}

variable "extra_environment" {
  description = "Any other HB_* variable from docs/deployment.md, by name. Overrides the values above."
  type        = map(string)
  default     = {}
}
