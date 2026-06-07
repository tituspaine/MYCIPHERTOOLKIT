const fastify = require('fastify')({ logger: false });
const Docker = require('dockerode');
const path = require('path');
const fs = require('fs-extra');
const { execSync } = require('child_process');
const httpProxy = require('http-proxy');

const docker = new Docker();
const proxy = httpProxy.createProxyServer({});
const io = require('socket.io')(fastify.server, { cors: { origin: '*' } });

fastify.register(require('@fastify/cors'), { origin: true });

// THE FIREWALL BYPASS
// Maps [NGROK_URL]/view/[NAME] to the internal container PORT
fastify.all('/view/:name/*', (request, reply) => {
    const { name } = request.params;
    (async () => {
        const containers = await docker.listContainers();
        const target = containers.find(c => c.Names[0].includes(name));
        if (!target) return reply.code(404).send({ error: 'NODE_OFFLINE' });
        
        const port = target.Ports[0].PublicPort;
        proxy.web(request.raw, reply.raw, { target: `http://localhost:${port}` });
    })();
});

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
    try {
        const repoMatch = cloneCommand.match(/github\.com\/([\w-]+\/[\w.-]+)/i);
        const repoName = repoMatch[1].split('/').pop().toLowerCase();
        const workDir = path.join(__dirname, 'tmp', repoName);
        const repoUrl = githubToken ? `https://${githubToken}@github.com/${repoMatch[1]}.git` : cloneCommand;

        if (fs.existsSync(workDir)) fs.removeSync(workDir);
        fs.ensureDirSync(workDir);
        
        execSync(`git clone ${repoUrl} ${workDir}`);

        (async () => {
            const dockerfile = `FROM node:20-bookworm\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]`;
            fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile);
            const buildStream = await docker.buildImage({ context: workDir, src: ['Dockerfile', '.'] }, { t: repoName });
            docker.modem.followProgress(buildStream, async () => {
                const container = await docker.createContainer({ Image: repoName, name: `app-${repoName}-${Date.now()}`, HostConfig: { PublishAllPorts: true } });
                await container.start();
            });
        })();
        return { status: 'DEPLOIMENT_INITIATED' };
    } catch (e) { return reply.code(500).send({ error: e.message }); }
});

fastify.listen({ port: 3000, host: '0.0.0.0' });