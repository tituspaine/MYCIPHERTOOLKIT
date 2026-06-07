const fastify = require('fastify')({ logger: false });
const Docker = require('dockerode');
const SimpleGit = require('simple-git');
const path = require('path');
const fs = require('fs-extra');
const { getUniversalDockerfile } = require('./engine/universal-builder');

const docker = new Docker();
const git = SimpleGit();

// Initialize WebSockets
const io = require('socket.io')(fastify.server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

fastify.register(require('@fastify/cors'), { origin: true });

fastify.get('/', async () => { return { status: 'ONLINE' }; });

fastify.post('/api/launch', async (req, reply) => {
    const { cloneCommand, githubToken } = req.body;
    const repoMatch = cloneCommand.match(/https:\/\/github\.com\/([\w-]+\/[\w.-]+)/);
    if (!repoMatch) return { error: 'INVALID_URL' };

    const repoPath = repoMatch[1].replace('.git', '');
    const repoName = repoPath.split('/').pop().toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);
    const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoPath}.git` : cloneCommand;

    process.nextTick(async () => {
        const broadcast = (msg) => { io.emit('build_log', `[${repoName.toUpperCase()}] ${msg}`); console.log(msg); };

        try {
            broadcast('STAGING_INITIATED');
            if (fs.existsSync(workDir)) fs.removeSync(workDir);
            
            broadcast('CLONING_REPOSITORY...');
            await git.clone(repoUrl, workDir);

            broadcast('GENERATING_RUNTIME_ENVIRONMENT...');
            const dockerfile = getUniversalDockerfile(workDir);
            fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);

            broadcast('BUILDING_IMAGE (This may take minutes)...');
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            
            docker.modem.followProgress(buildStream, 
              (err) => {
                if (err) return broadcast(`FATAL_ERROR: ${err.message}`);
                broadcast('IMAGE_READY. PROVISIONING_CONTAINER...');
                docker.createContainer({
                    Image: repoName,
                    HostConfig: { PublishAllPorts: true }
                }).then(c => c.start()).then(() => broadcast('DEPLOYMENT_SUCCESSFUL. SYSTEM_LIVE.'));
              },
              (event) => {
                if (event.stream) broadcast(event.stream.trim());
              }
            );
        } catch (err) {
            broadcast(`ERROR: ${err.message}`);
        }
    });

    return { status: 'DEPLOY_INITIATED' };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });