FROM node:20-alpine

WORKDIR /app

# Только необходимые файлы для запуска статического сервера
COPY package.json server.js index.html ./

ENV HOST=0.0.0.0
ENV PORT=7100

EXPOSE 7100

CMD ["node", "server.js"]
