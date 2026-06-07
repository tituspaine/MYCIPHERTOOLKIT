FROM node:20-bookworm

# Install Docker and Git inside the container so it can clone/build others
RUN apt-get update && apt-get install -y docker.io git

WORKDIR /usr/src/app

COPY orchestrator/package*.json ./orchestrator/
RUN cd orchestrator && npm install

COPY . .

EXPOSE 3000

CMD ["node", "orchestrator/server.js"]