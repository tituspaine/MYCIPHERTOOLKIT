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
    
    const repoMatch = cloneCommand.match(/github\.com\/([\w-]+\/[\w.-]+)/);
    if (!repoMatch) return { error: 'INVALID_URL' };
    
    const repoPath = repoMatch[1].replace('.git', '');
    const repoName = repoPath.split('/').pop().toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);
    const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoPath}.git` : `https://github.com/${repoPath}.git`;

    process.nextTick(async () => {
        const broadcast = (m) => { io.emit('build_log', m); console.log(`[BUILD_LOG] ${m}`); };
        try {
            broadcast(`[STAGING] Preparing directory for ${repoName}...`);
            await fs.ensureDir(path.join(__dirname, 'tmp'));
            if (fs.existsSync(workDir)) await fs.remove(workDir);
            
            broadcast('[CLONING] Harvesting repository code...');
            await git.clone(repoUrl, workDir).catch(err => {
                throw new Error(`Git Clone Failed: ${err.message}`);
            });
            
            broadcast('[ENGINE] Generating universal Docker configuration...');
            const dockerfile = getUniversalDockerfile(workDir);
            fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);
            
            broadcast('[BUILD] Starting Docker build process...');
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            
            docker.modem.followProgress(buildStream, async (err) => {
                if (err) return broadcast(`[FATAL] Docker Build Error: ${err.message}`);
                
                broadcast('[DEPLOY] Initializing high-performance container...');
                const container = await docker.createContainer({ 
                    Image: repoName, 
                    name: `app-${repoName}-${Date.now()}`,
                    HostConfig: { PublishAllPorts: true } 
                });
                await container.start();
                broadcast(`[SUCCESS] ${repoName} is now live.`);
            });
        } catch (e) {
            broadcast(`[CRITICAL_FAILURE] ${e.message}`);
        }
    });
    return { status: 'BUILD_SEQUENCED' };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });