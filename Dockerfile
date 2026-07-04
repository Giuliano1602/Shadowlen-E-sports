FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Install Chromium + OS dependencies for Playwright (used by /tracking)
RUN npx playwright install --with-deps chromium

ENV NODE_ENV=production
CMD ["npm", "start"]
