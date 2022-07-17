FROM node:16-alpine3.14

COPY package*.json /tmp/
RUN cd /tmp && npm install

WORKDIR /app

COPY . .

RUN mv /tmp/node_modules .

ENV GITHUB_API_KEY=apikey
ENV DB_URL=mongodb://localhost:27017/top-contributors
ENV NODE_ENV=development

EXPOSE 8080

CMD [ "npm", "run", "start" ]