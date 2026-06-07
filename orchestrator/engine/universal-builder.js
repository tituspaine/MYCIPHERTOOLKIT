const fs = require('fs-extra');
const path = require('path');

function getUniversalDockerfile(workDir) {
    let base = 'FROM node:20-bookworm-slim';
    let installTools = 'RUN apt-get update && apt-get install -y git curl build-essential ';
    let buildSteps = '';
    let port = 3000;

    // Deep Heuristic for any Tooling Requirements
    if (fs.existsSync(path.join(workDir, 'Cargo.toml'))) {
        base = 'FROM rust:latest';
        buildSteps = 'RUN cargo build --release';
        port = 8080;
    } else if (fs.existsSync(path.join(workDir, 'requirements.txt'))) {
        base = 'FROM python:3.11-slim';
        installTools += 'python3-dev libpq-dev ';
        buildSteps = 'RUN pip install --no-cache-dir -r requirements.txt';
        port = 5000;
    } else if (fs.existsSync(path.join(workDir, 'go.mod'))) {
        base = 'FROM golang:1.21';
        buildSteps = 'RUN go build -o main .';
        port = 8081;
    }

    return `
${base}
${installTools}
WORKDIR /app
COPY . .
${buildSteps}
EXPOSE ${port}
CMD ["sh", "-c", "if [ -f .env.example ]; then cp .env.example .env; fi; exec npm start || ./main || python main.py"]
`;
}

module.exports = { getUniversalDockerfile };