const fastify = require('fastify')({ logger: true });

const start = async () => {
  try {
    // Minimal CORS
    await fastify.register(require('@fastify/cors'), {
      origin: true
    });

    // Root Check
    fastify.get('/', async () => {
      return { status: 'ONLINE', timestamp: new Date().toISOString() };
    });

    // Launch API placeholder
    fastify.post('/api/launch', async (request, reply) => {
      return { status: 'PENDING' };
    });

    console.log('BOOT: Attempting to bind to 0.0.0.0:3000...');
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    
    console.log('BOOT: SUCCESS. Server is live and listening.');
  } catch (err) {
    console.error('BOOT: FATAL ERROR DURING STARTUP:');
    console.error(err);
    process.exit(1);
  }
};

start();