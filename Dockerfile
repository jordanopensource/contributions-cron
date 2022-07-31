ARG GITHUB_API_KEY=apikey DB_URL=mongodb://localhost:27017/top-contributors NODE_ENV=development USER=node  PORT=8080

###########
# BUILDER #
###########
FROM node:16-alpine3.14 AS builder

# pass the global args
ARG GITHUB_API_KEY
ARG DB_URL
ARG NODE_ENV
ARG PORT

# copy build context and install dependencies
WORKDIR /workspace
COPY . .

# Inject the enviromental variables
ENV GITHUB_API_KEY=${GITHUB_API_KEY} DB_URL=${DB_URL} NODE_ENV=${NODE_ENV} PORT=${PORT} 

RUN npm install

###########
# PROJECT #
###########
FROM node:16-slim

# pass the global args
ARG GITHUB_API_KEY
ARG DB_URL
ARG NODE_ENV
ARG USER

# copy builder output to project workdir
WORKDIR /app
COPY --from=builder --chown=${USER}:${USER} /workspace/models /app/models
COPY --from=builder --chown=${USER}:${USER} /workspace/utils /app/utils
COPY --from=builder --chown=${USER}:${USER} /workspace/server.js /app/server.js
COPY --from=builder --chown=${USER}:${USER} /workspace/node_modules /app/node_modules
COPY --from=builder --chown=${USER}:${USER} /workspace/package.json /app/

# Inject the enviromental variables
ENV GITHUB_API_KEY=${GITHUB_API_KEY} DB_URL=${DB_URL} NODE_ENV=${NODE_ENV} PORT=${PORT} 

# set user context
USER ${USER}

EXPOSE ${PORT}

CMD [ "npm", "run", "start" ]