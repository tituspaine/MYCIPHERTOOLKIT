const fastify = require('fastify')({ logger: true });
const Docker = require('dockerode');
const SimpleGit = require('simple-git');
const path = require('path');
const fs = require('fs-extra');
const { getUniversalDockerfile } = require('./engine/universal-builder');

const docker = new Docker();
const git = SimpleGit();
const io = require('socket.io')(fastify.server, { cors: { origin: '*' } });

// Aggressive CORS and Parsing
fastify.register(require('@fastify/cors'), { origin: true });

// THE HANDSHAKE FIX (Prevents 404)
fastify.get('/', async (request, reply) => {
    reply.code(200).send({ status: 'ONLINE', node: 'MYCIPHER_CORE' });
});

// The rest of your production logic
fastify.get('/api/projects', async () => {
    const containers = await docker.listContainers({ all: true });
    return containers
        .filter(c => c.Names[0].startsWith('/app-'))
        .map(c => ({
            name: c.Names[0].replace('/app-', '').split('-')[0],
            id: c.Id,
            status: c.State,
            port: c.Ports.find(p => p.PrivatePort === 3000 || p.PrivatePort === 8080)?.PublicPort || null
        }));
});

fastify.post('/api/launch', async (req, reply) => {
    const { cloneCommand, githubToken } = req.body;
    const repoMatch = cloneCommand.match(/https:\/\/github\.com\/([\w-]+\/[\w.-]+)/);
    if (!repoMatch) return { error: 'INVALID_URL' };
    
    const repoName = repoMatch[1].split('/').pop().toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);
    const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoMatch[1]}.git` : cloneCommand;

    process.nextTick(async () => {
        const broadcast = (msg) => { io.emit('build_log', msg); };
        try {
            if (fs.existsSync(workDir)) fs.removeSync(workDir);
            broadcast(`[STAGING] Cloning ${repoName}...`);
            await git.clone(repoUrl, workDir);
            
            const dockerfile = getUniversalDockerfile(workDir);
            fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);
            
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            docker.modem.followProgress(buildStream, async (err) => {
                if (err) return broadcast(`[ERROR] Build Failed: ${err.message}`);
                const container = await docker.createContainer({
                    Image: repoName,
                    HostConfig: { PublishAllPorts: true }
                });
                await container.start();
                broadcast('[SUCCESS] Project Live.');
            });
        } catch (e) { broadcast(`[FATAL] ${e.message}`); }
    });
    return { status: 'INITIATED' };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });