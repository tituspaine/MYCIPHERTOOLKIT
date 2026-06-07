const fastify = require('fastify')({ logger: true });
const Docker = require('dockerode');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

const docker = new Docker();
const io = require('socket.io')(fastify.server, { cors: { origin: '*' } });

fastify.register(require('@fastify/cors'), { origin: true });

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
    if (!repoMatch) return { error: 'INVALID_URL' };
    
    const repoPath = repoMatch[1].replace('.git', '');
    const repoName = repoPath.split('/').pop().toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);

    console.log(`>>> [INITIATING] ${repoName}`);
    
    try {
        if (fs.existsSync(workDir)) fs.removeSync(workDir);
        fs.ensureDirSync(workDir);

        const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoPath}.git` : cloneCommand;
        
        // FORCE EXECUTION
        console.log(`>>> [SHELL_START] CLONING ${repoName}`);
        execSync(`git clone ${repoUrl} ${workDir}`, { stdio: 'inherit' });
        console.log('>>> [SHELL_SUCCESS] REPO ON DISK');

        // Async from here for the heavy docker image building
        (async () => {
            const dockerfile = `FROM node:20-bookworm\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]`;
            fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);
            
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            docker.modem.followProgress(buildStream, async (err) => {
                if (err) return io.emit('build_log', `FATAL: ${err.message}`);
                const container = await docker.createContainer({ Image: repoName, name: `app-${repoName}-${Date.now()}`, HostConfig: { PublishAllPorts: true } });
                await container.start();
                io.emit('build_log', `[SUCCESS] ${repoName} is live.`);
            });
        })();

        return { status: 'CLONED_BUILD_STARTING' };
    } catch (e) {
        console.error('>>> [EXEC_FATAL]', e.message);
        return { status: 'FAILED', error: e.message };
    }
});

fastify.listen({ port: 3000, host: '0.0.0.0' });