# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

# better-sqlite3 compila do fonte quando não há prebuild para a plataforma
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages/shared packages/shared
COPY apps/web apps/web
COPY apps/server apps/server

RUN npm run build

# só as dependências de produção do servidor seguem para a imagem final
RUN npm prune --omit=dev

# O onnxruntime-web publica 87 MB de dist: uma variante de WebAssembly para cada
# combinação de navegador, WebGPU e treino. Em Node a cadeia usada é uma só —
# ort.node.min.mjs → ort-wasm-simd-threaded.mjs → .wasm — e são 11 MB. O resto
# nunca é carregado, então não tem por que viajar na imagem.
RUN find node_modules/onnxruntime-web/dist -type f \
      ! -name 'ort.node.min.mjs' ! -name 'ort.node.min.js' \
      ! -name 'ort-wasm-simd-threaded.mjs' ! -name 'ort-wasm-simd-threaded.wasm' \
      -delete

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/apps/web/dist

RUN mkdir -p /data && chown -R node:node /data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist

USER node
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
