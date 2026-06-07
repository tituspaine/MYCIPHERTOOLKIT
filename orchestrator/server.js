const fastify = require('fastify')({ logger: true });
const Docker = require('dockerode');
const SimpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');

const docker = new Docker();
const git = SimpleGit();

fastify.post('/api/launch', async (request, reply) => {
  const { cloneCommand } = request.body;
  const repoMatch = cloneCommand.match(/https:\/\/github\.com\/[\w-]+\/[\w.-]+/);
  
  if (!repoMatch) return reply.status(400).send({ error: 'Invalid GitHub URL' });
  
  const repoUrl = repoMatch[0];
  const repoName = repoUrl.split('/').pop().replace('.git', '');
  const workDir = path.join('/tmp', repoName);

  try {
    // 1. Clone repo
    if (!fs.existsSync(workDir)) {
      await git.clone(repoUrl, workDir);
    }

    // 2. Identify Stack
    let stack = 'UNKNOWN';
    let startCmd = '';
    if (fs.existsSync(path.join(workDir, 'package.json'))) {
      stack = 'NODE';
      startCmd = 'npm install && npm start';
    } else if (fs.existsSync(path.join(workDir, 'Cargo.toml'))) {
      stack = 'RUST';
      startCmd = 'cargo run --release';
    } else if (fs.existsSync(path.join(workDir, 'requirements.txt'))) {
      stack = 'PYTHON';
      startCmd = 'pip install -r requirements.txt && python main.py';
    }

    // 3. Trigger Docker Build (Abstraction)
    return { 
      status: 'Engine Primed', 
      repo: repoName, 
      detected_stack: stack, 
      instructions: `Spawning container for ${repoName} using ${stack}`
    };
  } catch (err) {
    return { error: err.message };
  }
});

fastify.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
  if (err) throw err;
  console.log('AutoLaunch Orchestrator running on port 3000');
});