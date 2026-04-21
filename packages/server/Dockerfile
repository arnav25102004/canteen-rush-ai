FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production
RUN npx prisma generate

COPY dist ./dist

EXPOSE 3001

CMD ["node", "dist/index.js"]
