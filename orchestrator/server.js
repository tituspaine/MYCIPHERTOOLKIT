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
    console.log('>>> EXECUTION_START');
    
    const repoMatch = cloneCommand.match(/github\.com\/([\w-]+\/[\w.-]+)/);
    if (!repoMatch) return { error: 'INVALID_URL' };
    
    const repoPath = repoMatch[1].replace('.git', '');
    const repoName = repoPath.split('/').pop().toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);
    const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoPath}.git` : cloneCommand;

    process.nextTick(async () => {
        const broadcast = (m) => { io.emit('build_log', m); console.log(`[LOG] ${m}`); };
        try {
            broadcast(`[STAGING] Cleaning ${repoName}...`);
            if (fs.existsSync(workDir)) fs.removeSync(workDir);
            fs.ensureDirSync(workDir);

            broadcast('[CLONING] Firing shell-level git clone...');
            execSync(`git clone ${repoUrl} ${workDir}`, { stdio: 'inherit' });

            broadcast('[CONTAINERIZING] Creating Dockerfile...');
            const dockerfile = `FROM node:20-bookworm\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]`;
            fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);

            broadcast('[BUILDING] Constructing image...');
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            
            docker.modem.followProgress(buildStream, async (err) => {
                if (err) return broadcast(`[FATAL] Build Error: ${err.message}`);
                
                broadcast('[FINALIZING] Launching instance...');
                const container = await docker.createContainer({
                    Image: repoName,
                    name: `app-${repoName}-${Date.now()}`,
                    HostConfig: { PublishAllPorts: true }
                });
                await container.start();
                broadcast(`[SUCCESS] ${repoName} is live.`);
            });
        } catch (e) {
            broadcast(`[CRITICAL_EXEC_ERROR] ${e.message}`);
        }
    });
    return { server_status: 'PROCESSING' };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });