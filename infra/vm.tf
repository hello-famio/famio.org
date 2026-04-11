# Static external IP — free while attached to a running instance in free-tier regions.
resource "google_compute_address" "smtp_proxy" {
  name   = "famio-smtp-proxy-ip"
  region = var.region
}

resource "google_compute_instance" "smtp_proxy" {
  name         = "famio-smtp-proxy"
  machine_type = "e2-micro" # always-free tier in us-central1 / us-east1 / us-west1
  zone         = var.zone

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 10 # GB — well within the free 30 GB allowance
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.smtp_proxy.address
    }
  }

  metadata = {
    user-data = templatefile("${path.module}/cloud-init.yaml", {
      smtp_relay_secret   = var.smtp_relay_secret
      worker_internal_url = var.worker_internal_url
      deploy_user         = var.deploy_user
      ghcr_image          = var.ghcr_image
    })
  }

  tags = ["famio-smtp-proxy"]

  lifecycle {
    create_before_destroy = true
  }
}

output "smtp_proxy_ip" {
  value       = google_compute_address.smtp_proxy.address
  description = "Set smtp.famio.org A record to this IP"
}
