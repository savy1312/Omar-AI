# Omar AI — versione web (Hugging Face Spaces, Koyeb, qualsiasi host Docker).
FROM node:22-alpine
WORKDIR /app

# dipendenze (solo produzione)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# codice (restano fuori via .dockerignore: .env, data/, node_modules, segreti)
COPY . ./

# default per hosting: Hugging Face Spaces vuole la porta 7860
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DESKTOP_ONLY=false \
    TRUST_PROXY=true \
    PORT=7860
RUN mkdir -p /app/data/uploads
EXPOSE 7860

# controllo di salute: GET /desktop/ping
CMD ["npm", "start"]
