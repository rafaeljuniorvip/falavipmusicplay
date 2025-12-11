FROM python:3.11-slim

WORKDIR /app

# Instalar dependências do sistema (FFmpeg para mixagem de áudio)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copiar requirements e instalar dependências Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código da aplicação
COPY . .

# Criar diretórios necessários
RUN mkdir -p /app/storage /app/static /app/data

# Expor porta
EXPOSE 8000

# Volumes para persistência
VOLUME ["/app/storage", "/app/data"]

# Variáveis de ambiente
ENV PYTHONUNBUFFERED=1
ENV STORAGE_DIR=/app/storage
ENV DATA_DIR=/app/data

# Comando de inicialização
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
