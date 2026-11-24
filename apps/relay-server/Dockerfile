# Build from the repository root:  docker build -f apps/relay-server/Dockerfile -t fristy-relay .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/relay-server ./apps/relay-server
RUN npm ci --workspace @fristy/relay-server --include-workspace-root=false --ignore-scripts \
 && npx esbuild apps/relay-server/src/main.ts --bundle --platform=node --target=node22 --outfile=/out/relay.js

FROM node:22-alpine
WORKDIR /app
COPY --from=build /out/relay.js ./relay.js
USER node
ENV PORT=8443
EXPOSE 8443
CMD ["node", "relay.js"]
