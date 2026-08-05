FROM node:20-alpine
# pg_dump para o backup diário. `postgresql16-client` acompanha a imagem do Postgres do
# compose — versão de cliente mais VELHA que o servidor recusa o dump, então mexer numa
# exige conferir a outra.
RUN apk add --no-cache postgresql16-client
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
RUN mkdir -p /app/uploads
EXPOSE 3001
CMD ["node", "src/index.js"]
