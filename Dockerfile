FROM node:17-alpine3.12

WORKDIR /app
COPY package*.json /tmp/

RUN cd /tmp && npm install && cp -r node_modules/ /app

ENV GITHUB_API_KEY=apikey
ENV DB_URL=mongodb://localhost:27017/top-contributors
ENV NODE_ENV=development

COPY . .

EXPOSE 8080

CMD [ "npm", "run", "start" ]