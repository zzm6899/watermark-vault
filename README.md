# watermark-vault Docker Deployment

## Files overview

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build: Node 20 builds the app, nginx serves it on port 5066 |
| `nginx.conf` | Nginx config listening on port 5066 with SPA routing support |
| `docker-compose.yml` | Pulls pre-built image from GHCR and runs it |
| `.github/workflows/docker-build.yml` | CI/CD: auto-builds & pushes to GHCR on every push to `main` |

---

## GitHub Actions Setup

The workflow lives at `.github/workflows/docker-build.yml`. It:

1. Triggers on every push to `main` (or manually via the GitHub UI)
2. Builds the Docker image from source
3. Pushes it to **GitHub Container Registry (GHCR)** as `ghcr.io/<owner>/watermark-vault:latest`

**No secrets needed** — it uses the built-in `GITHUB_TOKEN`.

To push the workflow to your repo:
```bash
mkdir -p .github/workflows
cp docker-build.yml .github/workflows/
git add .github/workflows/docker-build.yml
git commit -m "Add Docker build workflow"
git push
```

The image will be visible at:
`https://github.com/<your-username>/watermark-vault/pkgs/container/watermark-vault`

---

## Deploy on TrueNAS SCALE

### Step 1 — Make the package public (one-time)

After the first Actions run, go to:
`GitHub → Your profile → Packages → watermark-vault → Package settings → Change visibility → Public`

(Or keep it private and add a GHCR login step to TrueNAS — see below.)

### Step 2 — Deploy via docker-compose

SSH into TrueNAS and run:

```bash
mkdir -p /mnt/pool/watermark-vault
cd /mnt/pool/watermark-vault

# Copy docker-compose.yml here, then:
docker compose up -d
```

App will be available at: **`http://<truenas-ip>:5066`**

### Step 3 — Updating

Whenever you push to `main`, GitHub Actions rebuilds the image. To update TrueNAS:

```bash
docker compose pull && docker compose up -d
```

---

## Private package? Authenticate GHCR on TrueNAS

```bash
# Create a GitHub Personal Access Token with read:packages scope
# https://github.com/settings/tokens

echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

Then `docker compose up -d` will work as normal.
