FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json .eslintrc.js ./
RUN npm install

COPY src ./src
RUN npm run all

FROM node:24-alpine AS runtime

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

CMD [ "node", "dist/index.js" ]