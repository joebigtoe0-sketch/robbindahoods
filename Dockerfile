FROM node:20-alpine

WORKDIR /app

# native build tools for better-sqlite3 (prebuilt binaries usually skip this, kept as fallback)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public

ENV NODE_ENV=production
# persist the SQLite db on a mounted volume (e.g. Railway volume at /data)
ENV DATABASE_PATH=/data/robhood.db

EXPOSE 3000
CMD ["node", "server/index.js"]
