const fastify = require('fastify')({ logger: false });
const Docker = require('dockerode');
const io = require('socket.io')(fastify.server);
const { getUniversalDockerfile } = require('./engine/universal-builder');
const fs = require('fs-extra');
const path = require('path');
const SimpleGit = require('simple-git');

const docker = new Docker();
const git = SimpleGit();

// SELF-HEALING: Restart apps on boot
async function heal() {
  const containers = await docker.listContainers({ all: true });
  for (const c of containers) {
    if (c.State !== 'running' && c.Names[0].startsWith('/app-')) {
      const container = docker.getContainer(c.Id);
      await container.start().catch(() => {});
    }
  }
}
heal();

fastify.register(require('@fastify/static'), { root: path.join(__dirname, '../'), prefix: '/' });

fastify.post('/api/launch', async (req, res) => {
    const { cloneCommand, envVars } = req.body;
    const repoMatch = cloneCommand.match(/https:\/\/github\.com\/[\w-]+\/[\w.-]+/);
    const repoName = 'app-' + repoMatch[0].split('/').pop().replace('.git', '').toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);
    
    await git.clone(repoMatch[0], workDir);
    fs.writeFileSync(path.join(workDir, 'Dockerfile'), getUniversalDockerfile(workDir));
    if (envVars) fs.writeFileSync(path.join(workDir, '.env'), envVars);

    const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
    docker.modem.followProgress(buildStream, async (err) => {
        if (err) return;
        const container = await docker.createContainer({ Image: repoName, HostConfig: { RestartPolicy: { Name: 'always' }, PublishAllPorts: true } });
        await container.start();
    });
    return { status: 'STARTED' };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });