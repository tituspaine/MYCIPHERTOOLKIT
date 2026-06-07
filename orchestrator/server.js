const fastify = require('fastify')({ logger: false });
const path = require('path');
const fs = require('fs-extra');
const { execSync } = require('child_process');
const Docker = require('dockerode');
const docker = new Docker();
const io = require('socket.io')(fastify.server, { cors: { origin: '*' } });

fastify.register(require('@fastify/cors'), { origin: true });

// THE PROXY GATEWAY
// This allows you to view any app by going to [NGROK_URL]/view/[APP_NAME]
fastify.get('/view/:name', async (request, reply) => {
    const { name } = request.params;
    const containers = await docker.listContainers();
    const target = containers.find(c => c.Names[0].includes(name.toLowerCase()));
    
    if (!target) return reply.code(404).send({ error: 'APP_NOT_FOUND' });
    
    const port = target.Ports[0]?.PublicPort;
    // Redirect to the VPS IP + Port directly
    return reply.redirect(`http://148.230.81.199:${port}`);
});

fastify.get('/api/projects', async () => {
    const containers = await docker.listContainers({ all: true });
    return containers.map(c => ({
        name: c.Names[0].replace('/', ''),
        port: c.Ports[0]?.PublicPort || null
    }));
});

fastify.post('/api/launch', async (req, reply) => {
    const { cloneCommand, githubToken } = req.body;
    try {
        const repoMatch = cloneCommand.match(/github\.com\/([\w-]+\/[\w.-]+)/i);
        if (!repoMatch) throw new Error('INVALID_URL');
        const repoName = repoMatch[1].split('/').pop().toLowerCase();
        const workDir = path.join(__dirname, 'tmp', repoName);
        const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoMatch[1]}.git` : cloneCommand;

        if (fs.existsSync(workDir)) fs.removeSync(workDir);
        fs.ensureDirSync(workDir);
        execSync(`git clone ${repoUrl} ${workDir}`);

        (async () => {
            const dockerfile = `FROM node:20-bookworm\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]`;
            await fs.writeFile(path.join(workDir, 'Dockerfile'), dockerfile);
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            docker.modem.followProgress(buildStream, async () => {
                const container = await docker.createContainer({ Image: repoName, name: `app-${repoName}-${Date.now()}`, HostConfig: { PublishAllPorts: true } });
                await container.start();
            });
        })();
        return { status: 'STARTED' };
    } catch (e) { return reply.code(500).send({ error: e.message }); }
});

fastify.listen({ port: 3000, host: '0.0.0.0' });