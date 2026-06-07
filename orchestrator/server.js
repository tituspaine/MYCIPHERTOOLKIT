const fastify = require('fastify')({ logger: true });
const Docker = require('dockerode');
const fs = require('fs-extra');
const path = require('path');
const SimpleGit = require('simple-git');
const { getUniversalDockerfile } = require('./engine/universal-builder');

const docker = new Docker();
const git = SimpleGit();

fastify.register(require('@fastify/cors'), { origin: true });

fastify.get('/', async () => { return { status: 'ONLINE' }; });

fastify.post('/api/launch', async (req, reply) => {
    const { cloneCommand, githubToken } = req.body;
    
    // Clean the URL: Remove trailing slashes and common junk
    const cleanUrl = cloneCommand.trim().replace(/\/+$/, '');
    const repoMatch = cleanUrl.match(/github\.com\/([\w-]+\/[\w.-]+)/);
    
    if (!repoMatch) return { error: 'INVALID_URL' };

    let repoPath = repoMatch[1];
    if (repoPath.endsWith('.git')) repoPath = repoPath.slice(0, -4);

    const repoName = repoPath.split('/').pop().toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);

    // Construct Authenticated URL correctly
    const finalCloneUrl = githubToken 
        ? `https://${githubToken}@github.com/${repoPath}.git` 
        : `https://github.com/${repoPath}.git`;

    process.nextTick(async () => {
        try {
            console.log(`[BOOT] Deploying ${repoName}`);
            if (fs.existsSync(workDir)) fs.removeSync(workDir);
            
            console.log(`[1/3] Cloning from: ${finalCloneUrl.replace(githubToken, '***')}`);
            await git.clone(finalCloneUrl, workDir);

            console.log(`[2/3] Building...`);
            const dockerfile = getUniversalDockerfile(workDir);
            fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);

            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            
            docker.modem.followProgress(buildStream, async (err) => {
                if (err) return console.error(`[FATAL] Build failed:`, err);
                const container = await docker.createContainer({
                    Image: repoName,
                    name: `app-${repoName}-${Date.now()}`,
                    HostConfig: { PublishAllPorts: true }
                });
                await container.start();
                console.log(`[SYSTEM] ${repoName} LIVE.`);
            });
        } catch (err) {
            console.error(`[ERROR] Clone failed:`, err.message);
        }
    });

    return { status: 'DEPLOY_INITIATED' };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });