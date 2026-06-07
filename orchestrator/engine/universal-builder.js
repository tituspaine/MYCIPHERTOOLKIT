const fs = require('fs-extra');
const path = require('path');

function getUniversalDockerfile(workDir) {
    let base = 'FROM alpine:latest'; // Start with smallest possible footprint
    let steps = ['RUN apk add --no-cache git curl build-base bash'];
    let port = 3000;

    // Deep Language Heuristics
    if (fs.existsSync(path.join(workDir, 'package.json'))) {
        base = 'FROM node:20-alpine';
        steps.push('COPY . .', 'RUN npm install');
    } else if (fs.existsSync(path.join(workDir, 'Cargo.toml'))) {
        base = 'FROM rust:alpine';
        steps.push('RUN apk add --no-cache musl-dev', 'COPY . .', 'RUN cargo build --release');
        port = 8080;
    } else if (fs.existsSync(path.join(workDir, 'requirements.txt'))) {
        base = 'FROM python:3.11-alpine';
        steps.push('RUN apk add --no-cache postgresql-dev libffi-dev', 'COPY . .', 'RUN pip install -r requirements.txt');
        port = 5000;
    } else if (fs.existsSync(path.join(workDir, 'go.mod'))) {
        base = 'FROM golang:alpine';
        steps.push('COPY . .', 'RUN go build -o app .');
        port = 8080;
    }

    return `
${base}
WORKDIR /app
${steps.join('\n')}
EXPOSE ${port}
CMD ["sh", "-c", "npm start || ./app || python main.py || cargo run --release"]
`;
}

module.exports = { getUniversalDockerfile };