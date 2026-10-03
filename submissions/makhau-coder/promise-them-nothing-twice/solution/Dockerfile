FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy application code
COPY src/ ./src/

# The app reads PORT and NODE_ID from environment variables
# These are set in docker-compose.yml

EXPOSE 3000

USER node
CMD ["node", "src/server.js"]
