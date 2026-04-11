variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region — must be us-central1, us-east1, or us-west1 for always-free e2-micro"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  type    = string
  default = "us-central1-a"
}

variable "smtp_relay_secret" {
  description = "Shared secret between SMTP proxy and Worker (/internal/smtp-send)"
  type        = string
  sensitive   = true
}

variable "worker_internal_url" {
  description = "Worker endpoint the proxy POSTs messages to"
  type        = string
  default     = "https://famio.org/internal/smtp-send"
}

variable "deploy_user" {
  description = "Non-root OS user created on the VM for SSH deploys"
  type        = string
  default     = "famio"
}

variable "ghcr_image" {
  description = "Full GHCR image reference, e.g. ghcr.io/your-org/famio-smtp:latest"
  type        = string
}

variable "deploy_ssh_pubkey" {
  description = "SSH public key for the deploy user (added to authorized_keys on the VM)"
  type        = string
}
