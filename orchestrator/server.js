const fastify = require('fastify')({ logger: true });
const Docker = require('dockerode');
const fs = require('fs-extra');
const path = require('path');

// Add CORS support to allow the Cloudflare UI to connect
fastify.register(require('@fastify/cors'), {
  origin: '*'
});

const docker = new Docker();

// Root Health Check
fastify.get('/', async () => {
  return { status: 'ONLINE', platform: 'MYCIPHER_AUTOLAUNCH' };
});

fastify.post('/api/launch', async (req, res) => {
  // ... existing launch logic ...
  return { status: 'RECEIVED' };
});

fastify.listen({ port: 3000, host: '0.0.0.0' });