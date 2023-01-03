ARG DATABASE_HOST=localhost DATABASE_PORT=27017 DATABASE_NAME=top-contributors HOST=localhost PORT=8080 USER=node TLS_ENABLED=true CA_PATH='/certificates/do-mongodb-ca-certificate.crt' NODE_ENV=development GITHUB_ACCESS_TOKEN=apikey

###########
# BUILDER #
###########
FROM node:16-alpine3.14 AS builder

# pass the global args
ARG GITHUB_ACCESS_TOKEN
ARG NODE_ENV
ARG HOST
ARG PORT
ARG DATABASE_HOST
ARG DATABASE_PORT
ARG DATABASE_NAME
ARG TLS_ENABLED
ARG CA_PATH

# copy build context and install dependencies
WORKDIR /workspace
COPY . .

# Inject the enviromental variables
ENV DATABASE_HOST=${DATABASE_HOST} DATABASE_PORT=${DATABASE_PORT} DATABASE_NAME=${DATABASE_NAME} PORT=${PORT} HOST=${HOST} NODE_ENV=${NODE_ENV} TLS_ENABLED=${TLS_ENABLED} CA_PATH=${CA_PATH} GITHUB_ACCESS_TOKEN=${GITHUB_ACCESS_TOKEN}

RUN npm install

###########
# PROJECT #
###########
FROM node:16-slim

# pass the global args
ARG GITHUB_ACCESS_TOKEN
ARG NODE_ENV
ARG HOST
ARG PORT
ARG DATABASE_HOST
ARG DATABASE_PORT
ARG DATABASE_NAME
ARG TLS_ENABLED
ARG CA_PATH
ARG USER

# copy builder output to project workdir
WORKDIR /app
COPY --from=builder --chown=${USER}:${USER} /workspace/models /app/models
COPY --from=builder --chown=${USER}:${USER} /workspace/utils /app/utils
COPY --from=builder --chown=${USER}:${USER} /workspace/server.js /app/server.js
COPY --from=builder --chown=${USER}:${USER} /workspace/node_modules /app/node_modules
COPY --from=builder --chown=${USER}:${USER} /workspace/package.json /app/
COPY --from=builder --chown=${USER}:${USER} /workspace/blockedRepos.txt /app/
COPY --from=builder --chown=${USER}:${USER} /workspace/blockedUsers.txt /app/

# Inject the enviromental variables
ENV DATABASE_HOST=${DATABASE_HOST} DATABASE_PORT=${DATABASE_PORT} DATABASE_NAME=${DATABASE_NAME} PORT=${PORT} HOST=${HOST} NODE_ENV=${NODE_ENV} TLS_ENABLED=${TLS_ENABLED} CA_PATH=${CA_PATH} GITHUB_ACCESS_TOKEN=${GITHUB_ACCESS_TOKEN}


# set user context
USER ${USER}

EXPOSE ${PORT}

CMD [ "npm", "run", "start" ]