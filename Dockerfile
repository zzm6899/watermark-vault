# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Clone the repo
RUN apk add --no-cache git && \
    git clone https://github.com/zzm6899/watermark-vault.git .

# Install dependencies and build
RUN npm install
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Custom nginx config to listen on port 5066
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5066

CMD ["nginx", "-g", "daemon off;"]
