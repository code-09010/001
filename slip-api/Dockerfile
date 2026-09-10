FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# 先装依赖，利用层缓存
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 3000

CMD ["node", "src/server.js"]
