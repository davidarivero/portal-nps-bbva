FROM node:22-alpine
# Tesseract lee los resultados de las evidencias (OCR) en español e inglés.
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-spa tesseract-ocr-data-eng
WORKDIR /app
COPY package.json server.js seed.js recorridos.js crear-usuarios.js ./
COPY public ./public
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
