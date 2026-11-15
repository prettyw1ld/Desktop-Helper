# Сервер присутствия Пушика. Образ без лишнего: node, pg и сам сервер, запуск не от root.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
# только pg, без скриптов установки: меньше поводов для атаки через зависимости
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force \
  && node -e "import('pg')"   # pg необязателен в package.json, но в образе он нужен: без сети сборка должна упасть, а не тихо его пропустить
COPY *.mjs ./
COPY public ./public
COPY tools ./tools
USER node
EXPOSE 8443
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8443/healthz || exit 1
CMD ["node", "index.mjs"]
