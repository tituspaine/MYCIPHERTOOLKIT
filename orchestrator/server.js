const fastify = require('fastify')({ logger: true });
const Docker = require('dockerode');
const SimpleGit = require('simple-git');
const path = require('path');
const fs = require('fs-extra');
const { getUniversalDockerfile } = require('./engine/universal-builder');

const docker = new Docker();
const git = SimpleGit();
const io = require('socket.io')(fastify.server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// FORCE OPEN GATEWAY
fastify.register(require('@fastify/cors'), { 
  origin: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning']
});

fastify.get('/', async () => { return { status: 'ONLINE', node: 'CORE' }; });

fastify.get('/api/projects', async () => {
    const containers = await docker.listContainers({ all: true });
    return containers.map(c => ({
        name: c.Names[0].replace('/', ''),
        port: c.Ports[0]?.PublicPort || null
    }));
});

fastify.post('/api/launch', async (req, reply) => {
    console.log('>>> [HANDSHAKE] COLD_START COMMAND RECEIVED');
    const { cloneCommand, githubToken } = req.body;
    const repoMatch = cloneCommand.match(/github\.com\/([\w-]+\/[\w.-]+)/);
    if (!repoMatch) return { error: 'INVALID_URL' };
    
    const repoName = repoMatch[1].split('/').pop().toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);
    const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoMatch[1]}.git` : cloneCommand;

    process.nextTick(async () => {
        const broadcast = (m) => { io.emit('build_log', m); console.log(m); };
        try {
            broadcast(`[STAGING] Preparing ${repoName}...`);
            if (fs.existsSync(workDir)) fs.removeSync(workDir);
            broadcast('[CLONING] Harvesting repository...');
            await git.clone(repoUrl, workDir);
            
            fs.writeFileSync(path.join(workDir, 'Dockerfile'), getUniversalDockerfile(workDir));
            broadcast('[BUILD] Constructing isolated environment...');
            
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            docker.modem.followProgress(buildStream, async (err) => {
                if (err) return broadcast(`[FATAL] ${err.message}`);
                const container = await docker.createContainer({ Image: repoName, HostConfig: { PublishAllPorts: true } });
                await container.start();
                broadcast(`[SUCCESS] ${repoName} is now live.`);
            });
        } catch (e) { broadcast(`[ERROR] ${e.message}`); }
    });
    return { status: 'RECEIPT_CONFIRMED' };
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