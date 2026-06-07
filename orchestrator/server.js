const fastify = require('fastify')({ logger: true });
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const Docker = require('dockerode');

const docker = new Docker();
const io = require('socket.io')(fastify.server, { cors: { origin: '*' } });

fastify.register(require('@fastify/cors'), { origin: true });

fastify.get('/api/projects', async () => {
    try {
        const containers = await docker.listContainers({ all: true });
        return containers.map(c => ({
            name: c.Names[0].replace('/', ''),
            port: c.Ports[0]?.PublicPort || null
        }));
    } catch (e) { return []; }
});

fastify.post('/api/launch', async (req, reply) => {
    console.log('>>> [HANDSHAKE] RECEIVED');
    const { cloneCommand, githubToken } = req.body;

    try {
        // CASE-INSENSITIVE REGEX FIX
        const repoMatch = cloneCommand.match(/github\.com\/([\w-]+\/[\w.-]+)/i);
        if (!repoMatch) throw new Error('INVALID_GITHUB_URL');

        const repoPath = repoMatch[1].replace('.git', '');
        const repoName = repoPath.split('/').pop().toLowerCase();
        const workDir = path.join(__dirname, 'tmp', repoName);

        if (fs.existsSync(workDir)) fs.removeSync(workDir);
        fs.ensureDirSync(workDir);

        const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoPath}.git` : cloneCommand;
        
        console.log(`>>> [SHELL] CLONING ${repoName}...`);
        execSync(`git clone ${repoUrl} ${workDir}`, { stdio: 'inherit' });

        (async () => {
            try {
                const dockerfile = `FROM node:20-bookworm\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]`;
                await fs.writeFile(path.join(workDir, 'Dockerfile'), dockerfile);
                const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
                docker.modem.followProgress(buildStream, async (err) => {
                    if (err) return io.emit('build_log', `ERROR: ${err.message}`);
                    const container = await docker.createContainer({ Image: repoName, name: `app-${repoName}-${Date.now()}`, HostConfig: { PublishAllPorts: true } });
                    await container.start();
                    io.emit('build_log', `[SUCCESS] ${repoName} IS LIVE.`);
                });
            } catch (inner) { console.error(inner); }
        })();

        return { status: 'CLONING_STARTED' };
    } catch (e) {
        console.error('>>> [LAUNCH_FATAL]', e.message);
        return reply.code(500).send({ error: e.message });
    }
});

fastify.listen({ port: 3000, host: '0.0.0.0' });