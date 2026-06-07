const fastify = require('fastify')({ logger: true });
const Docker = require('dockerode');
const fs = require('fs-extra');
const path = require('path');
const SimpleGit = require('simple-git');
const { getUniversalDockerfile } = require('./engine/universal-builder');

const docker = new Docker();
const git = SimpleGit();

fastify.register(require('@fastify/cors'), { origin: true });

// Health Check
fastify.get('/', async () => { return { status: 'ONLINE' }; });

fastify.post('/api/launch', async (req, reply) => {
    const { cloneCommand } = req.body;
    const repoMatch = cloneCommand.match(/https:\/\/github\.com\/[\w-]+\/[\w.-]+/);
    
    if (!repoMatch) return { error: 'INVALID_REPO_URL' };

    const repoUrl = repoMatch[0];
    const repoName = repoUrl.split('/').pop().replace('.git', '').toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);

    // Send immediate response so UI doesn't hang
    process.nextTick(async () => {
        try {
            console.log(`[BOOT] Starting deployment for ${repoName}`);
            if (fs.existsSync(workDir)) fs.removeSync(workDir);
            
            console.log(`[1/3] Cloning ${repoUrl}...`);
            await git.clone(repoUrl, workDir);

            console.log(`[2/3] Generating Universal Dockerfile...`);
            const dockerfile = getUniversalDockerfile(workDir);
            fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);

            console.log(`[3/3] Initiating Docker Build...`);
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            
            docker.modem.followProgress(buildStream, async (err) => {
                if (err) {
                    console.error(`[FATAL] Build failed for ${repoName}:`, err);
                    return;
                }
                console.log(`[SUCCESS] Build complete. Launching container...`);
                const container = await docker.createContainer({
                    Image: repoName,
                    name: `app-${repoName}-${Date.now()}`,
                    HostConfig: { PublishAllPorts: true }
                });
                await container.start();
                console.log(`[SYSTEM] ${repoName} is now LIVE.`);
            });
        } catch (err) {
            console.error(`[ERROR] Background process failed:`, err);
        }
    });

    return { status: 'DEPLOY_INITIATED', repo: repoName };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });