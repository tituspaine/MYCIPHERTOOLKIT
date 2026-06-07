const fastify = require('fastify')({ logger: false });
const Docker = require('dockerode');
const httpProxy = require('http-proxy');
const git = require('simple-git')();
const io = require('socket.io')(fastify.server);
const jwt = require('jsonwebtoken');
const fs = require('fs-extra');
const path = require('path');

const docker = new Docker();
const proxy = httpProxy.createProxyServer({});
const SECRET = 'SPATIAL_OS_888';
const runningApps = {}; // Map of subdomains to ports
let nextPort = 4000;

// 1. RECURSIVE PROXY ENGINE
fastify.addHook('onRequest', (request, reply, done) => {
  const host = request.headers.host;
  const subdomain = host.split('.')[0];
  if (runningApps[subdomain]) {
    proxy.web(request.raw, reply.raw, { target: `http://127.0.0.1:${runningApps[subdomain]}` });
    return;
  }
  done();
});

// 2. LIVE LOG STREAMING
io.on('connection', (socket) => {
  socket.on('join-logs', (repo) => socket.join(repo));
});

fastify.post('/api/launch', async (req, res) => {
  const { cloneCommand, envVars, usePostgres } = req.body;
  const repoUrl = cloneCommand.match(/https:\/\/github\.com\/[\w-]+\/[\w.-]+/)[0];
  const repoName = repoUrl.split('/').pop().replace('.git', '').toLowerCase();
  const workDir = path.join(__dirname, 'tmp', repoName);
  const appPort = nextPort++;

  // Env Injection
  await fs.ensureDir(workDir);
  if(envVars) await fs.writeFile(path.join(workDir, '.env'), envVars);

  // Auto-DB Spinup
  if (usePostgres) {
    await docker.createContainer({ Image: 'postgres:15', name: `${repoName}-db`, Env: ['POSTGRES_PASSWORD=pass'] }).then(c => c.start());
  }

  // Build logic with log streaming
  const stream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
  docker.modem.followProgress(stream, (err, output) => {
    if(!err) {
        docker.createContainer({ 
            Image: repoName, 
            HostConfig: { PortBindings: { '3000/tcp': [{ HostPort: appPort.toString() }] } } 
        }).then(c => {
            c.start();
            runningApps[repoName] = appPort;
            io.to(repoName).emit('status', 'LIVE');
        });
    }
  }, (event) => io.to(repoName).emit('log', event.stream));

  return { subdomain: repoName, status: 'BUILDING' };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });