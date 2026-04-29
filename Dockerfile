FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV DATA_DIR=/data

VOLUME ["/data"]

CMD ["node", "src/bot.js"]
