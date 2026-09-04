FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js .
RUN addgroup -S proxy && adduser -S proxy -G proxy
USER proxy
EXPOSE 3456
CMD ["node", "server.js"]
