const fastify = require('fastify')({ logger: false });
const Docker = require('dockerode');
const SimpleGit = require('simple-git');
const path = require('path');
const fs = require('fs-extra');
const { getUniversalDockerfile } = require('./engine/universal-builder');

const docker = new Docker();
const git = SimpleGit();
const io = require('socket.io')(fastify.server, { cors: { origin: '*' } });

fastify.register(require('@fastify/cors'), { origin: true });

// PROXY FORWARDER - Ensures the 'Open' button works via Ngrok
fastify.get('/proxy/:repoName', async (request, reply) => {
    const { repoName } = request.params;
    const containers = await docker.listContainers({ all: true });
    const container = containers.find(c => c.Names[0].includes(repoName));
    if (!container) return { error: 'Not Found' };
    const port = container.Ports[0]?.PublicPort;
    return reply.redirect(`http://localhost:${port}`);
});

fastify.get('/', async () => { return { status: 'ONLINE' }; });

fastify.get('/api/projects', async () => {
    const containers = await docker.listContainers({ all: true });
    return containers.map(c => ({
        name: c.Names[0].replace('/', ''),
        port: c.Ports[0]?.PublicPort || null
    }));
});

fastify.post('/api/launch', async (req, reply) => {
    const { cloneCommand, githubToken } = req.body;
    const repoMatch = cloneCommand.match(/github\.com\/([\w-]+\/[\w.-]+)/);
    const repoName = repoMatch[1].split('/').pop().toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);
    const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoMatch[1]}.git` : cloneCommand;

    process.nextTick(async () => {
        const broadcast = (m) => io.emit('build_log', m);
        try {
            broadcast(`[STAGING] Clearing ${repoName}...`);
            if (fs.existsSync(workDir)) fs.removeSync(workDir);
            broadcast('[CLONING] Harvesting repository...');
            await git.clone(repoUrl, workDir);
            const dockerfile = getUniversalDockerfile(workDir);
            fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);
            broadcast('[BUILD] Constructing isolated environment...');
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            docker.modem.followProgress(buildStream, async (err) => {
                if (err) return broadcast(`[FATAL] ${err.message}`);
                const container = await docker.createContainer({ Image: repoName, HostConfig: { PublishAllPorts: true } });
                await container.start();
                broadcast(`[LIVE] ${repoName} is operational.`);
            });
        } catch (e) { broadcast(`[ERROR] ${e.message}`); }
    });
    return { status: 'INITIATED' };
});

fastify.post('/api/destroy', async (req, reply) => {
    const { repoName } = req.body;
    const containers = await docker.listContainers({ all: true });
    for (const c of containers) {
        if (c.Names[0].includes(repoName)) {
            const container = docker.getContainer(c.Id);
            await container.stop().catch(() => {});
            await container.remove().catch(() => {});
        }
    }
    return { status: 'PURGED' };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });