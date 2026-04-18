FROM node:20-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm install --no-audit --no-fund && npm run build && npm prune --production

FROM node:20-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/Ezzio11/prompt-compressor"
LABEL org.opencontainers.image.description="SuperZ Prompt Compressor MCP server"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app
ENV NODE_ENV=production
ENV SUPERZ_LOG=info

RUN addgroup -S superz && adduser -S superz -G superz
COPY --from=build --chown=superz:superz /app/package.json ./package.json
COPY --from=build --chown=superz:superz /app/node_modules ./node_modules
COPY --from=build --chown=superz:superz /app/dist ./dist

USER superz
EXPOSE 7420

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve", "--http", "--host", "0.0.0.0", "--port", "7420"]
