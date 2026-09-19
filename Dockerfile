FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=optional --ignore-scripts
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data

USER node
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
