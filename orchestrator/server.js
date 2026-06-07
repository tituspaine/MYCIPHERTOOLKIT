const fastify = require('fastify')({ logger: true });

// Fully permissive CORS
fastify.register(require('@fastify/cors'), {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  credentials: true
});

const Docker = require('dockerode');
const docker = new Docker();

// Basic Health Check on root
fastify.get('/', async (request, reply) => {
  return { status: 'ONLINE', timestamp: new Date().toISOString() };
});

// Ensure the server listens on ALL interfaces (0.0.0.0)
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('🚀 Platform Brain live on port 3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();