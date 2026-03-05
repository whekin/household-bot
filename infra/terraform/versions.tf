terraform {
  required_version = ">= 1.8.0"

  backend "gcs" {
    # The bucket will need to be configured via `terraform init -backend-config="bucket=<YOUR_BUCKET>"`
    # or you can hardcode the bucket name here. Since it's a generic module, we leave it to be configured via init args.
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}
