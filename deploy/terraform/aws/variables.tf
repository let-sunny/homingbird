variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "dovecote"
}

variable "image" {
  description = "Container image of Dovecote in a registry the task can pull from, such as ECR."
  type        = string
}

variable "public_url" {
  description = "The https URL people and agents use to reach Dovecote. Point its DNS name at the load balancer."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate for the host name in public_url."
  type        = string
}

variable "vpc_id" {
  description = "VPC to deploy into."
  type        = string
}

variable "public_subnet_ids" {
  description = "At least two public subnets, in different availability zones, for the load balancer."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "At least two private subnets with a route to a NAT gateway, for the task and the database."
  type        = list(string)
}

variable "ingress_cidr_blocks" {
  description = "Networks allowed to reach the load balancer. Narrow this to keep Dovecote inside a private network."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "oidc_issuer" {
  description = "OpenID Connect issuer used for sign-in."
  type        = string
  default     = "https://accounts.google.com"
}

variable "oidc_client_id" {
  description = "OAuth client id registered with the issuer. Its redirect URI is <public_url>/auth/callback."
  type        = string
}

variable "oidc_client_secret" {
  description = "OAuth client secret. Stored in Secrets Manager; also ends up in the Terraform state."
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
  description = "Fargate CPU units of the single Dovecote task (1024 is one vCPU). See docs/deployment.md for sizing."
  type        = number
  default     = 1024
}

variable "memory" {
  description = "Fargate memory of the single Dovecote task, in MiB."
  type        = number
  default     = 2048
}

variable "database_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.small"
}

variable "database_multi_az" {
  description = "Run RDS with a standby in a second availability zone."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "Days to keep the task's logs, which include the audit trail when HB_AUDIT_STDOUT=1."
  type        = number
  default     = 90
}

variable "deletion_protection" {
  description = "Refuse to destroy the database, and take a final snapshot if it is destroyed."
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
