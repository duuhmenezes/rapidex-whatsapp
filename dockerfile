FROM node:20-bullseye

# Instala Chromium e dependências
RUN apt-get update && apt-get install -y chromium \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Corrige permissão e espaço compartilhado
RUN mkdir -p /dev/shm && chmod 1777 /dev/shm

EXPOSE 8000
CMD ["npm", "start"]
