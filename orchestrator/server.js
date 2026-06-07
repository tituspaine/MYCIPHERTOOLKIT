const fastify = require('fastify')({ logger: false });
const Docker = require('dockerode');
const io = require('socket.io')(fastify.server);
const { getUniversalDockerfile } = require('./engine/universal-builder');
const fs = require('fs-extra');
const path = require('path');
const SimpleGit = require('simple-git');

const docker = new Docker();
const git = SimpleGit();
let currentPort = 4000;

fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../'),
  prefix: '/',
});

fastify.post('/api/launch', async (req, res) => {
  const { cloneCommand, envVars } = req.body;
  const repoMatch = cloneCommand.match(/https:\/\/github\.com\/[\w-]+\/[\w.-]+/);
  if (!repoMatch) return { error: 'INVALID_URL' };

  const repoName = repoMatch[0].split('/').pop().replace('.git', '').toLowerCase();
  const workDir = path.join(__dirname, 'tmp', repoName);
  const appPort = currentPort++;

  try {
    io.emit('logs', `[SYSTEM] CLONING: ${repoName}...`);
    if (fs.existsSync(workDir)) fs.removeSync(workDir);
    await git.clone(repoMatch[0], workDir);

    const dockerfile = getUniversalDockerfile(workDir);
    fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);
    if (envVars) fs.writeFileSync(path.join(workDir, '.env'), envVars);

    io.emit('logs', `[SYSTEM] BUILDING IMAGE FOR PORT ${appPort}...`);
    const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
    
    docker.modem.followProgress(buildStream, async (err) => {
      if (err) return io.emit('logs', `[FATAL] BUILD_FAILED: ${err}`);
      
      const container = await docker.createContainer({
        Image: repoName,
        ExposedPorts: { '3000/tcp': {} },
        HostConfig: { PortBindings: { '3000/tcp': [{ HostPort: appPort.toString() }] } }
      });

      await container.start();
      io.emit('logs', `[SUCCESS] DEPLOYED_LIVE: port ${appPort}`);
      io.emit('deployed', { name: repoName, port: appPort });
    });

    return { status: 'INITIALIZED' };
  } catch (err) {
    return { error: err.message };
  }
});

fastify.listen({ port: 3000, host: '0.0.0.0' });