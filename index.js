require('dotenv').config();
const express = require('express');
const http = require('http');
const swaggerUi = require('swagger-ui-express');
const cors = require('cors');

// Import routes
const hostelRoutes = require('./routes/hostels');
const stageRoutes = require('./routes/stages');
const userRoutes = require('./routes/users');

// Import socket manager
const { setupSocketIO } = require('./sockets/socketManager');

// Import swagger docs
const swaggerDocs = require('./config/swagger');

// Initialize Redis (using the updated original service)
const redisService = require('./services/redisService');

// App setup
const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Redis and Socket.IO in sequence
const initServices = async () => {
  try {
    console.log('🚀 Initializing server services...');
    
    // Wait a moment before initializing Redis (gives the server time to start)
    console.log('⏳ Waiting for server to stabilize...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Initialize Redis first with explicit config from environment
    console.log('⏳ Initializing Redis service...');
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10)
    };
    console.log(`📌 Using Redis config: ${JSON.stringify({...redisConfig, password: redisConfig.password ? '***' : undefined})}`);
    
    await redisService.initRedis(redisConfig);
    console.log('✅ Redis service initialized');
    
    // Make sure Redis is connected before proceeding
    if (!redisService.isRedisConnected()) {
      console.error('⚠️ Redis connection not established, Socket.IO may encounter issues');
    } else {
      console.log('✅ Redis connection verified');
    }
    
    // Then initialize Socket.IO after Redis is ready
    console.log('⏳ Setting up Socket.IO...');
    const io = setupSocketIO(server);
    console.log('✅ Socket.IO initialized');
    
    return io;
  } catch (error) {
    console.error('❌ Error during service initialization:', error);
    console.log('⚠️ Continuing without full Redis/Socket.IO initialization');
    return null;
  }
};

// Middleware
app.use(express.json());
app.use(cors());

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Serve static files from the 'public' directory under the '/peregrinapp' path
app.use('/peregrinapp', express.static('public'));

// Routes
app.use('/peregrinapp/hostels', hostelRoutes);
app.use('/peregrinapp/stages', stageRoutes);
app.use('/peregrinapp/users', userRoutes);

// Start server
server.listen(port, async () => {
  console.log(`🚀 Server running on port ${port}`);
  
  // Initialize services after server is listening
  await initServices();
  
  console.log(`📚 API documentation available at http://localhost:${port}/api-docs`);
});