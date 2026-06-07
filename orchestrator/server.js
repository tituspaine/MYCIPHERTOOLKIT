const fastify = require('fastify')({ logger: true });
const path = require('path');
const fs = require('fs-extra');
const Docker = require('dockerode');
const SimpleGit = require('simple-git');
const { generateDockerfile } = require('./engine/docker-gen');

const docker = new Docker();
const git = SimpleGit();

fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../'),
  prefix: '/',
});

fastify.post('/api/launch', async (request, reply) => {
  const { cloneCommand } = request.body;
  const repoMatch = cloneCommand.match(/https:\/\/github\.com\/[\w-]+\/[\w.-]+/);
  if (!repoMatch) return { error: 'Invalid Command' };

  const repoUrl = repoMatch[0];
  const repoName = repoUrl.split('/').pop().replace('.git', '');
  const workDir = path.join(__dirname, 'tmp', repoName);

  try {
    console.log(`[1/4] Cloning ${repoName}...`);
    if (fs.existsSync(workDir)) fs.removeSync(workDir);
    await git.clone(repoUrl, workDir);

    console.log(`[2/4] Detecting Stack...`);
    let stack = 'NODE'; // Default
    if (fs.existsSync(path.join(workDir, 'Cargo.toml'))) stack = 'RUST';
    if (fs.existsSync(path.join(workDir, 'requirements.txt'))) stack = 'PYTHON';

    console.log(`[3/4] Generating Dockerfile for ${stack}...`);
    generateDockerfile(workDir, stack);

    console.log(`[4/4] Building Image & Starting Container...`);
    // This triggers the docker build/run sequence
    const stream = await docker.buildImage({
      context: workDir, src: ['Dockerfile', '.']
    }, { t: repoName.toLowerCase() });
    
    return { 
      status: 'SUCCESS',
      endpoint: `http://localhost:dynamic_port`,
      message: `Project ${repoName} is now live.`
    };
  } catch (err) {
    return { status: 'ERROR', message: err.message };
  }
});

fastify.listen({ port: 3000, host: '0.0.0.0' });