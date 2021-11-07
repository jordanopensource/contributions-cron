FROM node:17-alpine3.12

WORKDIR /app
COPY package*.json /tmp/

RUN cd /tmp && npm install && cp -r node_modules/ /app

COPY . .

EXPOSE 8080

CMD [ "node", "server.js" ]