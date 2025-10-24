# Usa uma imagem já otimizada pro Puppeteer
FROM ghcr.io/puppeteer/puppeteer:latest

# Cria a pasta de trabalho
WORKDIR /app

# Copia os arquivos do projeto
COPY package*.json ./
RUN npm install

# Copia o resto do código
COPY . .

# Expõe a porta que o app usa
EXPOSE 8000

# Comando pra iniciar
CMD ["node", "server.js"]