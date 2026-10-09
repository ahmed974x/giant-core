FROM node:22.12.0-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY config ./config
USER node
EXPOSE 8090
CMD ["node", "server.js"]
