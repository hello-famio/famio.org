terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Remote state in GCS — create the bucket once before first apply:
  #   gsutil mb -l us-central1 gs://famio-terraform-state
  #   gsutil versioning set on gs://famio-terraform-state
  backend "gcs" {
    bucket = "famio-terraform-state"
    prefix = "smtp-proxy"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
