FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# デフォルトコマンドは reply.ts の起動とするが、docker-compose でオーバーライド可能
CMD ["npx", "ts-node", "src/reply.ts"]
