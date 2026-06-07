const fs = require('fs-extra');
const path = require('path');

function generateDockerfile(workDir, stack) {
  let content = '';
  switch (stack) {
    case 'NODE':
      content = `FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["npm", "start"]`;
      break;
    case 'RUST':
      content = `FROM rust:latest\nWORKDIR /app\nCOPY . .\nRUN cargo build --release\nEXPOSE 8080\nCMD ["./target/release/server"]`;
      break;
    case 'PYTHON':
      content = `FROM python:3.11-slim\nWORKDIR /app\nCOPY . .\nRUN pip install -r requirements.txt\nEXPOSE 5000\nCMD ["python", "main.py"]`;
      break;
  }
  fs.writeFileSync(path.join(workDir, 'Dockerfile'), content);
}

module.exports = { generateDockerfile };