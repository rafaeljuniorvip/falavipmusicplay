FROM node:20-slim

WORKDIR /app

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copiar package files
COPY package*.json ./

# Instalar dependências
RUN npm install

# Instalar expo-cli globalmente
RUN npm install -g @expo/ngrok

# Copiar código
COPY . .

# Expor portas do Expo
EXPOSE 8081 19000 19001 19002

# Comando para iniciar com tunnel
CMD ["npx", "expo", "start", "--tunnel"]
