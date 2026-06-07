const fastify = require('fastify')({ logger: false });
const Docker = require('dockerode');
const io = require('socket.io')(fastify.server);
const { getUniversalDockerfile } = require('./engine/universal-builder');
const fs = require('fs-extra');
const path = require('path');
const SimpleGit = require('simple-git');

const docker = new Docker();
const git = SimpleGit();
const runningApps = {};

fastify.post('/api/launch', async (req, res) => {
    const { cloneCommand, envVars } = req.body;
    const repoMatch = cloneCommand.match(/https:\/\/github\.com\/[\w-]+\/[\w.-]+/);
    const repoName = repoMatch[0].split('/').pop().replace('.git', '').toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);

    io.emit('logs', `[SYSTEM] DETECTING HARDWARE CAPABILITIES...`);
    await git.clone(repoMatch[0], workDir);

    // Universal Dockerfile with all tools needed for this specific repo
    const dockerfile = getUniversalDockerfile(workDir);
    fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);
    
    // Live Env Injection
    if (envVars) fs.writeFileSync(path.join(workDir, '.env'), envVars);

    const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
    
    docker.modem.followProgress(buildStream, async (err, output) => {
        if (err) return io.emit('logs', `[ERROR] BUILD_FAILED: ${err}`);
        
        const container = await docker.createContainer({
            Image: repoName,
            HostConfig: { 
                Memory: 512 * 1024 * 1024, // Optimized for any device size
                PublishAllPorts: true 
            }
        });
        
        await container.start();
        const data = await container.inspect();
        const port = data.NetworkSettings.Ports['3000/tcp']?.[0].HostPort || 'DYNAMIC';
        
        io.emit('logs', `[SUCCESS] REPO_LIVE_ON_PORT: ${port}`);
    });

    return { status: 'BUILDING' };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });