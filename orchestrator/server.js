const fastify = require('fastify')({ logger: true });
const Docker = require('dockerode');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const util = require('util');
const execAsync = util.promisify(exec);

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
    const { cloneCommand, githubToken } = req.body;
    const repoMatch = cloneCommand.match(/github\.com\/([\w-]+\/[\w.-]+)/);
    if (!repoMatch) return { error: 'INVALID_URL' };
    
    const repoPath = repoMatch[1].replace('.git', '');
    const repoName = repoPath.split('/').pop().toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);

    // Fire and forget the build so the API responds immediately
    (async () => {
        const broadcast = (m) => { 
            io.emit('build_log', m); 
            console.log(`[BUILD_LOG] ${repoName}: ${m}`); 
        };

        try {
            broadcast('PHASE_1: FILESYSTEM_INIT');
            await fs.ensureDir(path.join(__dirname, 'tmp'));
            if (await fs.pathExists(workDir)) await fs.remove(workDir);
            
            broadcast('PHASE_2: CLONING_REPOSITORY');
            const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoPath}.git` : cloneCommand;
            await execAsync(`git clone ${repoUrl} ${workDir}`);

            broadcast('PHASE_3: CONTAINERIZING');
            const dockerfile = `FROM node:20-bookworm\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]`;
            await fs.writeFile(path.join(workDir, 'Dockerfile'), dockerfile);

            broadcast('PHASE_4: DOCKER_BUILD_START');
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            
            await new Promise((resolve, reject) => {
                docker.modem.followProgress(buildStream, (err, res) => err ? reject(err) : resolve(res));
            });

            broadcast('PHASE_5: DEPLOYING');
            const container = await docker.createContainer({
                Image: repoName,
                name: `app-${repoName}-${Date.now()}`,
                HostConfig: { PublishAllPorts: true }
            });
            await container.start();
            broadcast(`[SUCCESS] ${repoName} is live.`);

        } catch (e) {
            broadcast(`[CRITICAL_ERROR] ${e.message}`);
            console.error(e);
        }
    })();

    return { status: 'BUILD_SEQUENCED', target: repoName };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });