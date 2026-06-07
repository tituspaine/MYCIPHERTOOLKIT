const fastify = require('fastify')({ logger: true });
const Docker = require('dockerode');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

const docker = new Docker();
const io = require('socket.io')(fastify.server, { cors: { origin: '*' } });

fastify.register(require('@fastify/cors'), { origin: true });

// AUTH & POLICIES
fastify.get('/api/projects', async () => {
    try {
        const containers = await docker.listContainers({ all: true });
        return containers.map(c => ({
            name: c.Names[0].replace('/', ''),
            port: c.Ports[0]?.PublicPort || null
        }));
    } catch (e) {
        console.error('PROJ_SYNC_ERR:', e.message);
        return [];
    }
});

fastify.post('/api/launch', async (req, reply) => {
    // LOG EVERYTHING IMMEDIATELY
    console.log('>>> [HANDSHAKE] RECEIVED AT API');
    const { cloneCommand, githubToken } = req.body;

    try {
        if (!cloneCommand) throw new Error('MISSING_REPO_URL');
        const repoMatch = cloneCommand.match(/github\.com\/([\w-]+\/[\w.-]+)/);
        if (!repoMatch) throw new Error('INVALID_GITHUB_URL');

        const repoPath = repoMatch[1].replace('.git', '');
        const repoName = repoPath.split('/').pop().toLowerCase();
        const workDir = path.join('/usr/src/app', 'tmp', repoName);

        console.log(`>>> [INIT] ${repoName} -> ${workDir}`);

        // Cleanup old attempts
        if (fs.existsSync(workDir)) fs.removeSync(workDir);
        fs.ensureDirSync(workDir);

        const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoPath}.git` : cloneCommand;
        
        // RUN CLONE SYNCHRONOUSLY SO WE SEE ERRORS
        console.log('>>> [SHELL] STARTING CLONE...');
        execSync(`git clone ${repoUrl} ${workDir}`, { stdio: 'inherit' });
        console.log('>>> [SHELL] CLONE SUCCESS');

        // Building Docker Image Async
        (async () => {
            try {
                const dockerfile = `FROM node:20-bookworm\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]`;
                fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);
                
                const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
                
                docker.modem.followProgress(buildStream, async (err) => {
                    if (err) return io.emit('build_log', `FATAL: ${err.message}`);
                    const container = await docker.createContainer({ Image: repoName, name: `app-${repoName}-${Date.now()}`, HostConfig: { PublishAllPorts: true } });
                    await container.start();
                    io.emit('build_log', `[SUCCESS] ${repoName} IS LIVE.`);
                });
            } catch (innerE) {
                console.error('INNER_BUILD_ERR:', innerE.message);
                io.emit('build_log', `[BUILD_CRASH] ${innerE.message}`);
            }
        })();

        return { status: 'CLONE_COMPLETE_BUILD_STARTED' };

    } catch (e) {
        console.error('>>> [LAUNCH_FATAL]', e.message);
        return reply.code(500).send({ status: 'FAILED', error: e.message });
    }
});

fastify.listen({ port: 3000, host: '0.0.0.0' });