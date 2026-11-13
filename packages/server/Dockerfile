FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev
RUN npx prisma generate

COPY dist ./dist

EXPOSE 3001

CMD ["node", "dist/index.js"]
