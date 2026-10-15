FROM node:22.12.0-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY quant.js server.js ./
USER node
EXPOSE 8091
CMD ["node", "server.js"]
