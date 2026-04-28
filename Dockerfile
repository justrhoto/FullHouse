FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV DATA_DIR=/data

VOLUME ["/data"]

CMD ["node", "bot.js"]
