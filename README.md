# watermark-vault Docker Deployment

## Files
- `Dockerfile` — Multi-stage build: Node 20 builds the app, nginx serves it
- `nginx.conf` — Nginx config listening on port **5066**
- `docker-compose.yml` — Compose file for easy deployment

## Deploy on TrueNAS SCALE

### Option A: Docker Compose (TrueNAS SCALE with Docker)

1. Copy all three files to your TrueNAS server (e.g., `/mnt/pool/watermark-vault/`)
2. SSH into TrueNAS and run:

```bash
cd /mnt/pool/watermark-vault
docker compose up -d --build
```

3. Access the app at: `http://<truenas-ip>:5066`

### Option B: TrueNAS SCALE Apps (Custom App)

1. Go to **Apps → Custom App**
2. Set the image source to build from this repo, or pre-build and push to a registry:

```bash
# Build and tag
docker build -t watermark-vault:latest .

# Push to local registry or Docker Hub
docker tag watermark-vault:latest your-registry/watermark-vault:latest
docker push your-registry/watermark-vault:latest
```

3. In TrueNAS Custom App config:
   - **Image:** `your-registry/watermark-vault:latest`
   - **Port Forwarding:** Host `5066` → Container `5066`
   - **Restart Policy:** `unless-stopped`

### Rebuilding after updates

```bash
docker compose down
docker compose up -d --build
```

## Notes
- This is a pure frontend app — no backend/database needed
- All processing happens client-side in the browser
- The build clones directly from GitHub, so you need internet access during build time
