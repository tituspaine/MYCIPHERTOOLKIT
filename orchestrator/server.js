const fastify = require('fastify')({ logger: true });
const Docker = require('dockerode');

fastify.register(require('@fastify/cors'), {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS']
});

const docker = new Docker();

fastify.get('/', async () => {
  return { status: 'ONLINE', version: '1.2.0' };
});

// Start the server - Explicitly binding to 0.0.0.0
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Orchestrator live on 0.0.0.0:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();