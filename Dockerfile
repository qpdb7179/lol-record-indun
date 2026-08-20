FROM node:18-alpine

# better-sqlite3는 alpine(musl)용 prebuild가 없어 소스 빌드가 필요함
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
