resource "google_compute_firewall" "smtp_submission" {
  name    = "famio-smtp-submission"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["587"]
  }

  # Allow all sources for now. Tighten to Gmail/Outlook IP ranges once confirmed working.
  # Gmail SMTP client ranges: 66.102.0.0/20, 74.125.0.0/16, 209.85.128.0/17
  # Outlook ranges: 40.92.0.0/15, 40.107.0.0/16, 52.100.0.0/14
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["famio-smtp-proxy"]
}

resource "google_compute_firewall" "acme_http" {
  name    = "famio-smtp-proxy-acme-http"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80"]
  }

  # certbot renews with the standalone HTTP-01 authenticator, which needs port 80
  # reachable from Let's Encrypt. Their validation IPs aren't published, so this
  # can't be narrowed. Nothing else should listen on 80 (nginx was disabled for this).
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["famio-smtp-proxy"]
}

resource "google_compute_firewall" "https_egress_allowed" {
  name      = "famio-smtp-proxy-allow-https-egress"
  network   = "default"
  direction = "EGRESS"

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }

  destination_ranges = ["0.0.0.0/0"]
  target_tags        = ["famio-smtp-proxy"]
}

resource "google_compute_firewall" "ssh" {
  name    = "famio-smtp-proxy-ssh"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  # Restrict to your CI/CD runner IPs in production.
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["famio-smtp-proxy"]
}
