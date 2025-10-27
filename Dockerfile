# Dockerfile simple
FROM debian:12-slim

ENV DEBIAN_FRONTEND=noninteractive PORT=8000

# Instalar dependencias del sistema y Node.js 20
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash curl ca-certificates gdal-bin jq zip unzip python3 proj-bin \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/*

# Instalar mapshaper globalmente
RUN npm install -g mapshaper

WORKDIR /app

# Copiar package.json e instalar dependencias de Node
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copiar el resto de la aplicación
COPY . .

# Asegurar permisos de ejecución
RUN chmod +x ./run_export.sh

EXPOSE 8000

CMD ["node", "server.js"]
