const fastify = require('fastify')({ logger: false });
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
    return containers
        .filter(c => c.Names[0].startsWith('/app-'))
        .map(c => ({
            name: c.Names[0].replace('/app-', '').split('-')[0],
            id: c.Id,
            status: c.State,
            port: c.Ports.find(p => p.PrivatePort === 3000 || p.PrivatePort === 8080)?.PublicPort || (c.Ports[0] ? c.Ports[0].PublicPort : null)
        }));
});

fastify.post('/api/destroy', async (req, reply) => {
    const { repoName } = req.body;
    const containers = await docker.listContainers({ all: true });
    for (const c of containers) {
        if (c.Image === repoName || c.Names[0].includes(repoName)) {
            const container = docker.getContainer(c.Id);
            await container.stop().catch(() => {});
            await container.remove().catch(() => {});
        }
    }
    const workDir = path.join(__dirname, 'tmp', repoName);
    if (fs.existsSync(workDir)) fs.removeSync(workDir);
    return { status: 'DELETED' };
});

fastify.post('/api/launch', async (req, reply) => {
    const { cloneCommand, githubToken } = req.body;
    const repoMatch = cloneCommand.match(/https:\/\/github\.com\/([\w-]+\/[\w.-]+)/);
    if (!repoMatch) return { error: 'INVALID_URL' };
    let repoPath = repoMatch[1].replace('.git', '');
    const repoName = repoPath.split('/').pop().toLowerCase();
    const workDir = path.join(__dirname, 'tmp', repoName);
    const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoPath}.git` : `https://github.com/${repoPath}.git`;

    process.nextTick(async () => {
        const broadcast = (msg) => { io.emit('build_log', msg); };
        try {
            if (fs.existsSync(workDir)) {
                broadcast(`CACHE_HIT: Syncing ${repoName}...`);
                await SimpleGit(workDir).pull();
            } else {
                broadcast(`CLONING: ${repoName}...`);
                await git.clone(repoUrl, workDir);
            }
            broadcast('BUILD_STARTING...');
            const dockerfile = getUniversalDockerfile(workDir);
            fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            docker.modem.followProgress(buildStream, async (err) => {
                if (err) return broadcast(`BUILD_FAILED: ${err.message}`);
                const containers = await docker.listContainers({ all: true });
                for (const c of containers) {
                    if (c.Image === repoName) {
                        const container = docker.getContainer(c.Id);
                        await container.stop().catch(() => {});
                        await container.remove().catch(() => {});
                    }
                }
                const container = await docker.createContainer({
                    Image: repoName,
                    name: `app-${repoName}-${Date.now()}`,
                    HostConfig: { PublishAllPorts: true }
                });
                await container.start();
                const details = await container.inspect();
                const port = details.NetworkSettings.Ports['3000/tcp']?.[0].HostPort || details.NetworkSettings.Ports['8080/tcp']?.[0].HostPort || 'DYN';
                broadcast(`DEPLOYMENT_SUCCESSFUL. PORT:${port}`);
                io.emit('project_ready', { name: repoName, port });
            });
        } catch (err) { broadcast(`FATAL: ${err.message}`); }
    });
    return { status: 'INITIATED' };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });