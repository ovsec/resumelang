# GCloud Setup — resumelang

Project ID: `resumelang`  
Project Number: `481781083907`  
Region: `us-central1`  
Cloud Run service account: `481781083907-compute@developer.gserviceaccount.com`

---

## 1. Prerequisites

```bash
gcloud auth login
gcloud config set project resumelang
```

---

## 2. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  containerregistry.googleapis.com \
  firestore.googleapis.com
```

---

## 3. Fix: grant Secret Manager access to Cloud Run SA

**This fixes the current deployment failure.**

The default Compute Engine service account needs `secretAccessor` on each secret (or at project level).

### Option A — project-level (simplest)

```bash
gcloud projects add-iam-policy-binding resumelang \
  --member="serviceAccount:481781083907-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Option B — per-secret (least privilege)

```bash
for SECRET in RL_GITHUB_CLIENT_ID RL_GITHUB_CLIENT_SECRET RL_AUTH_SECRET GROQ_API_KEY; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --project=resumelang \
    --member="serviceAccount:481781083907-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 4. Create secrets

Run once to create. Skip if secrets already exist.

```bash
# GitHub OAuth app credentials
echo -n "YOUR_GITHUB_CLIENT_ID" | \
  gcloud secrets create RL_GITHUB_CLIENT_ID --data-file=- --project=resumelang

echo -n "YOUR_GITHUB_CLIENT_SECRET" | \
  gcloud secrets create RL_GITHUB_CLIENT_SECRET --data-file=- --project=resumelang

# Random 32-byte hex string for session signing
echo -n "$(openssl rand -hex 32)" | \
  gcloud secrets create RL_AUTH_SECRET --data-file=- --project=resumelang

# Groq API key
echo -n "YOUR_GROQ_API_KEY" | \
  gcloud secrets create GROQ_API_KEY --data-file=- --project=resumelang
```

### Update an existing secret version

```bash
echo -n "NEW_VALUE" | \
  gcloud secrets versions add SECRET_NAME --data-file=- --project=resumelang
```

---

## 5. Grant Cloud Build access to deploy Cloud Run

Cloud Build SA needs permission to deploy and act as the Cloud Run SA.

```bash
PROJECT_NUMBER=481781083907
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding resumelang \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding resumelang \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser"

# Cloud Build also needs to read secrets to inject during build (if needed)
gcloud projects add-iam-policy-binding resumelang \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

---

## 6. Connect Cloud Build trigger (GitHub → Cloud Build)

```bash
# Via console: https://console.cloud.google.com/cloud-build/triggers
# Or via gcloud (requires GitHub connection already set up in console):
gcloud builds triggers create github \
  --project=resumelang \
  --repo-name=resumelang \
  --repo-owner=ovsec \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yml
```

---

## 7. Firestore setup

```bash
# Create native-mode Firestore database (one-time)
gcloud firestore databases create \
  --project=resumelang \
  --location=us-central1
```

---

## 8. Container Registry

Images are pushed to `gcr.io/resumelang/resumelang:<sha>`.  
No extra setup needed after enabling the API — Cloud Build has push access by default.

---

## 9. Cloud Run service — manual deploy (for testing)

```bash
gcloud run deploy resumelang \
  --image gcr.io/resumelang/resumelang:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars GOOGLE_CLOUD_PROJECT=resumelang \
  --set-secrets RL_GITHUB_CLIENT_ID=RL_GITHUB_CLIENT_ID:latest,RL_GITHUB_CLIENT_SECRET=RL_GITHUB_CLIENT_SECRET:latest,RL_AUTH_SECRET=RL_AUTH_SECRET:latest,GROQ_API_KEY=GROQ_API_KEY:latest \
  --project resumelang
```

---

## 10. GitHub Actions — required repository secret

| Secret | Value |
|--------|-------|
| `GCP_SA_KEY` | JSON key for a service account with `roles/cloudbuild.builds.editor` + `roles/storage.admin` (or use Workload Identity — see below) |

### Workload Identity Federation (recommended over SA key)

```bash
# Create WIF pool
gcloud iam workload-identity-pools create github-pool \
  --project=resumelang \
  --location=global \
  --display-name="GitHub Actions pool"

# Create OIDC provider
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --project=resumelang \
  --location=global \
  --workload-identity-pool=github-pool \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='ovsec/resumelang'"

# Bind to SA
gcloud iam service-accounts add-iam-policy-binding \
  481781083907-compute@developer.gserviceaccount.com \
  --project=resumelang \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/481781083907/locations/global/workloadIdentityPools/github-pool/attribute.repository/ovsec/resumelang"
```

---

## Quick-fix checklist for current error

```bash
# Run this — fixes the deployment failure immediately
gcloud projects add-iam-policy-binding resumelang \
  --member="serviceAccount:481781083907-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Then re-trigger the build. The four secrets will mount successfully.
