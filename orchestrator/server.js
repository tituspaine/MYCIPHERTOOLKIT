const fastify = require('fastify')({ logger: true });
const path = require('path');
const fs = require('fs-extra');
const Docker = require('dockerode');
const SimpleGit = require('simple-git');
const jwt = require('jsonwebtoken');
const { generateDockerfile } = require('./engine/docker-gen');

const docker = new Docker();
const git = SimpleGit();
const SECRET = 'SPATIAL_OS_SECURE_KEY_888';

// Basic Memory Store for Demo (Swap for DB in v2)
const users = { 'admin': 'TRP_SECURE_PASS' };
let currentPort = 4000;

fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../'),
  prefix: '/',
});

fastify.post('/api/login', async (request, reply) => {
  const { username, password } = request.body;
  if (users[username] === password) {
    const token = jwt.sign({ username }, SECRET, { expiresIn: '7d' });
    return { token };
  }
  return reply.status(401).send({ error: 'Auth Failed' });
});

fastify.post('/api/launch', async (request, reply) => {
  const token = request.headers.authorization?.split(' ')[1];
  if (!token) return reply.status(401).send({ error: 'Token Required' });

  const { cloneCommand } = request.body;
  const repoMatch = cloneCommand.match(/https:\/\/github\.com\/[\w-]+\/[\w.-]+/);
  const repoUrl = repoMatch[0];
  const repoName = repoUrl.split('/').pop().replace('.git', '').toLowerCase();
  const workDir = path.join(__dirname, 'tmp', repoName);
  const assignedPort = currentPort++;

  try {
    await git.clone(repoUrl, workDir);
    generateDockerfile(workDir, 'NODE'); // Heuristic simplified for brevity
    
    const stream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
    await new Promise((resolve) => docker.modem.followProgress(stream, resolve));

    const container = await docker.createContainer({
      Image: repoName,
      ExposedPorts: { '3000/tcp': {} },
      HostConfig: { PortBindings: { '3000/tcp': [{ HostPort: assignedPort.toString() }] } }
    });

    await container.start();
    return { status: 'LIVE', port: assignedPort, url: `http://vps-ip:${assignedPort}` };
  } catch (err) {
    return { error: err.message };
  }
});

fastify.listen({ port: 3000, host: '0.0.0.0' });