const fastify = require('fastify')({ logger: true });
const Docker = require('dockerode');
const SimpleGit = require('simple-git');
const path = require('path');
const fs = require('fs-extra');
const { getUniversalDockerfile } = require('./engine/universal-builder');

const docker = new Docker();
const git = SimpleGit();
const io = require('socket.io')(fastify.server, { cors: { origin: '*' } });

fastify.register(require('@fastify/cors'), { origin: true });

fastify.get('/', async () => {
    return { status: 'ONLINE', node: 'MYCIPHER_CORE' };
});

fastify.get('/api/projects', async () => {
    const containers = await docker.listContainers({ all: true });
    return containers.map(c => ({
        name: c.Names[0].replace('/', ''),
        id: c.Id,
        status: c.State,
        port: c.Ports[0]?.PublicPort || null
    }));
});

// REFINED PURGE LOGIC
fastify.post('/api/destroy', async (req, reply) => {
    const { repoName } = req.body;
    const containers = await docker.listContainers({ all: true });
    
    for (const c of containers) {
        if (c.Names[0].includes(repoName) || c.Image.includes(repoName)) {
            const container = docker.getContainer(c.Id);
            await container.stop().catch(() => {});
            await container.remove().catch(() => {});
        }
    }
    
    const workDir = path.join(__dirname, 'tmp', repoName);
    if (fs.existsSync(workDir)) fs.removeSync(workDir).catch(() => {});

    return { status: 'PURGED', target: repoName };
});

fastify.post('/api/launch', async (req, reply) => {
    const { cloneCommand, githubToken } = req.body;
    const repoMatch = cloneCommand.match(/https:\/\/github\.com\/([\w-]+\/[\w.-]+)/);
    if (!repoMatch) return { error: 'INVALID_URL' };
    
    const repoName = repoMatch[1].split('/').pop().toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);
    const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoMatch[1]}.git` : cloneCommand;

    process.nextTick(async () => {
        try {
            if (fs.existsSync(workDir)) fs.removeSync(workDir);
            await git.clone(repoUrl, workDir);
            const dockerfile = getUniversalDockerfile(workDir);
            fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);
            
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            docker.modem.followProgress(buildStream, async () => {
                const container = await docker.createContainer({
                    Image: repoName,
                    HostConfig: { PublishAllPorts: true }
                });
                await container.start();
                io.emit('build_log', `[SUCCESS] ${repoName} is live.`);
            });
        } catch (e) { io.emit('build_log', `[ERROR] ${e.message}`); }
    });
    return { status: 'INITIATED' };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });