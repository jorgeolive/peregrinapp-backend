require('dotenv').config();
const redis = require('redis');
const net = require('net');

// Read Redis configuration from .env
const host = process.env.REDIS_HOST || 'localhost';
const port = parseInt(process.env.REDIS_PORT || '6379', 10);
const password = process.env.REDIS_PASSWORD;
const db = parseInt(process.env.REDIS_DB || '0', 10);

console.log(`🔧 Redis configuration:`);
console.log(`📌 Host: ${host}`);
console.log(`📌 Port: ${port}`);
console.log(`📌 DB: ${db}`);
console.log(`📌 Password: ${password ? 'Configured' : 'Not configured'}`);

// First check if the port is open using a TCP connection
console.log(`\n⏳ Checking if Redis port ${port} is open on ${host}...`);
const socket = new net.Socket();
const connectionTimeout = setTimeout(() => {
  socket.destroy();
  console.error(`❌ Timeout connecting to ${host}:${port} - port appears to be closed or blocked`);
  checkRedisConnection();
}, 5000);

socket.on('connect', () => {
  clearTimeout(connectionTimeout);
  console.log(`✅ Connection to ${host}:${port} succeeded - port is open`);
  socket.destroy();
  checkRedisConnection();
});

socket.on('error', (err) => {
  clearTimeout(connectionTimeout);
  console.error(`❌ Failed to connect to ${host}:${port}: ${err.message}`);
  
  if (host === 'localhost') {
    console.log(`\n📋 If running Redis in Docker, ensure it's exposed to the host:`);
    console.log('   docker run -p 6379:6379 redis');
    console.log('   or check that your container mapping is correct');
  }
  
  checkRedisConnection();
});

socket.connect(port, host);

// Modern Redis client connection test
async function checkRedisConnection() {
  console.log(`\n⏳ Attempting to connect to Redis at ${host}:${port}...`);
  
  // Add overall timeout to prevent the script from hanging indefinitely
  const overallTimeout = setTimeout(() => {
    console.error('❌ Redis connection check timed out after 15 seconds');
    console.log('\n📋 Troubleshooting tips:');
    console.log('  1. Make sure Redis server is running');
    console.log('  2. Check if Redis is running on a different port');
    console.log('  3. Verify your network configuration allows the connection');
    console.log('  4. Try running: redis-cli ping (if Redis is installed locally)');
    process.exit(1);
  }, 15000);

  // Create redis client using socket configuration
  const redisClient = redis.createClient({
    password: password || undefined,
    socket: {
      host: host,
      port: port,
      reconnectStrategy: (retries) => {
        console.log(`🔄 Redis retry attempt ${retries}`);
        if (retries > 2) {
          clearTimeout(overallTimeout);
          console.error('❌ Too many connection attempts');
          return new Error('Too many connection attempts');
        }
        return Math.min(retries * 100, 2000);
      }
    }
  });
  
  // Event handlers for new Redis client
  redisClient.on('connect', () => {
    console.log('✅ Redis client connected');
  });
  
  redisClient.on('ready', () => {
    console.log('✅ Redis client ready');
    clearTimeout(overallTimeout);
  });
  
  redisClient.on('error', (err) => {
    console.error('❌ Redis error:', err);
    clearTimeout(overallTimeout);
    
    console.log('\n📋 Troubleshooting tips:');
    
    if (err.code === 'ECONNREFUSED') {
      console.log('  1. Make sure Redis server is running');
      if (host === 'localhost') {
        console.log('  2. If using Docker, ensure the port is correctly published with -p 6379:6379');
        console.log('  3. Check if Redis is running on a different port (default is 6379)');
      } else {
        console.log(`  2. Verify the hostname "${host}" is correct`);
        console.log('  3. Ensure your network allows connections to this host/port');
      }
    } else if (err.code === 'NOAUTH') {
      console.log('  1. Redis requires authentication, but you provided incorrect password');
      console.log('  2. Set the correct REDIS_PASSWORD in your .env file');
    }
    
    console.log('  4. Check your .env file for correct Redis configuration:');
    console.log('     REDIS_HOST=localhost');
    console.log('     REDIS_PORT=6379');
    console.log('     REDIS_PASSWORD=your_password_if_needed');
    
    try {
      redisClient.quit();
    } catch (e) {
      console.error('Error during quit:', e);
    }
    process.exit(1);
  });

  try {
    // Connect first
    console.log('⏳ Connecting to Redis...');
    await redisClient.connect();
    
    // Try a PING command
    console.log('⏳ Sending PING command...');
    const pingResult = await redisClient.ping();
    console.log(`✅ Redis PING successful, response: ${pingResult}`);
    
    // Try to set and get a value
    const testKey = `test:${Date.now()}`;
    const testValue = 'Connection test value';
    
    console.log(`⏳ Setting test key "${testKey}"...`);
    await redisClient.set(testKey, testValue);
    console.log(`✅ Redis SET successful for key "${testKey}"`);
    
    console.log(`⏳ Getting test key "${testKey}"...`);
    const value = await redisClient.get(testKey);
    
    if (value === testValue) {
      console.log(`✅ Redis GET successful, retrieved "${value}"`);
    } else {
      console.error(`❌ Redis GET returned wrong value: "${value}" instead of "${testValue}"`);
    }
    
    // Clean up the test key
    console.log(`⏳ Deleting test key "${testKey}"...`);
    await redisClient.del(testKey);
    console.log(`✅ Test key deleted`);
    
    console.log('✅ Redis connection check completed successfully');
    clearTimeout(overallTimeout);
    await redisClient.quit();
    process.exit(0);
  } catch (error) {
    console.error('❌ Redis operation failed:', error);
    clearTimeout(overallTimeout);
    try {
      await redisClient.quit();
    } catch (e) {
      console.error('Error during quit:', e);
    }
    process.exit(1);
  }
} 