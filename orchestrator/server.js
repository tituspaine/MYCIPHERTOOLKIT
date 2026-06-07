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

fastify.get('/', async () => { return { status: 'ONLINE', node: 'CORE' }; });

fastify.get('/api/projects', async () => {
    const containers = await docker.listContainers({ all: true });
    return containers.map(c => ({
        name: c.Names[0].replace('/', ''),
        port: c.Ports[0]?.PublicPort || null
    }));
});

fastify.post('/api/launch', async (req, reply) => {
    console.log('>>> [HANDSHAKE] COLD_START RECEIVED');
    const { cloneCommand, githubToken } = req.body;
    
    // CLEAN URL LOGIC
    let cleanUrl = cloneCommand.trim();
    if (cleanUrl.endsWith('.git')) cleanUrl = cleanUrl.slice(0, -4);
    const repoMatch = cleanUrl.match(/github\.com\/([\w-]+\/[\w.-]+)/);
    
    if (!repoMatch) return { error: 'INVALID_URL' };
    
    const repoPath = repoMatch[1];
    const repoName = repoPath.split('/').pop().toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);
    const finalCloneUrl = githubToken ? `https://${githubToken}@github.com/${repoPath}.git` : `https://github.com/${repoPath}.git`;

    process.nextTick(async () => {
        const broadcast = (m) => { io.emit('build_log', m); console.log(m); };
        try {
            broadcast(`[STAGING] Target: ${repoName}`);
            if (fs.existsSync(workDir)) fs.removeSync(workDir);
            broadcast('[CLONING] Intent: Accessing Private Repo...');
            await git.clone(finalCloneUrl, workDir);
            
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

fastify.listen({ port: 3000, host: '0.0.0.0' });