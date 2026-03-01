# Stage 1: Build the React/Vite app
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
RUN npm install

# Copy the rest of the source and build
COPY . .
RUN npm run build

# Stage 2: Node.js server (serves React app + API)
FROM node:20-alpine

WORKDIR /app

# Install server dependencies
COPY server/package.json server/
RUN cd server && npm install --production

# Copy server code and built frontend
COPY server/ server/
COPY --from=builder /app/dist dist/

# Create data directory
RUN mkdir -p /data/uploads

EXPOSE 5066

ENV PORT=5066
ENV DATA_DIR=/data

CMD ["node", "server/index.js"]
