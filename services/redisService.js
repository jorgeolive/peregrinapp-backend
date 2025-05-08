const redis = require('redis');
const { promisify } = require('util');

// Create Redis clients - one for commands and one for pub/sub
let client = null;
let subscriber = null;
let publisher = null;
let redisCommands = {};

// Connection state tracking
let isConnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 2000; // 2 seconds

// Default Redis configuration
const DEFAULT_REDIS_CONFIG = {
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10)
  },
  password: process.env.REDIS_PASSWORD || undefined,
  database: parseInt(process.env.REDIS_DB || '0', 10)
};

// Key prefixes for better organization
const KEYS = {
  USER_POSITIONS: 'user:positions',   // For GEOADD
  USER_DETAILS: 'user:details:',      // Hash storing user details
  USER_UPDATE_CHANNEL: 'user:updates', // Pub/Sub channel for user updates
  USER_POSITION_KEY: 'user:position:', // Individual position keys with TTL
};

// Position expiry time in seconds (1 minute)
const POSITION_EXPIRY = 60;

// Helper to check if Redis client is ready and reconnect if needed
const ensureRedisConnection = async () => {
  if (isConnecting) {
    console.log('⏳ Redis connection already in progress, waiting...');
    // Wait for existing connection attempt to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    return;
  }

  if (!client || !client.isReady) {
    console.log('🔄 Redis client disconnected, attempting to reconnect...');
    await initRedis();
  }
};

// Initialize Redis connection
const initRedis = async (config = DEFAULT_REDIS_CONFIG) => {
  if (isConnecting) {
    console.log('⏳ Redis connection already in progress, skipping duplicate initialization');
    return false;
  }

  isConnecting = true;
  reconnectAttempts++;

  try {
    // Log the Redis configuration being used (without exposing password)
    const safeConfig = { ...config };
    if (safeConfig.password) {
      safeConfig.password = '******';
    }
    console.log(`🔄 Initializing Redis clients (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    console.log(`🔧 Redis configuration: ${JSON.stringify(safeConfig)}`);
    console.log(`📌 Connecting to Redis at ${config.socket.host}:${config.socket.port} (DB: ${config.database})`);
    
    // Close existing connections if they exist
    if (client) {
      try {
        console.log('🔄 Closing existing Redis client connections...');
        await client.quit();
        await subscriber.quit();
        await publisher.quit();
      } catch (err) {
        console.warn('⚠️ Error closing existing Redis connections:', err.message);
      }
    }

    // Main client for commands
    console.log('⏳ Creating Redis main client...');
    const mainClient = redis.createClient(config);
    
    // Separate clients for pub/sub
    console.log('⏳ Creating Redis subscriber client...');
    const subClient = redis.createClient(config);
    console.log('⏳ Creating Redis publisher client...');
    const pubClient = redis.createClient(config);
    
    // Handle connection events
    mainClient.on('error', (err) => console.error('❌ Redis error:', err));
    mainClient.on('connect', () => console.log('✅ Redis client connected'));
    mainClient.on('ready', () => console.log('✅ Redis client ready'));
    mainClient.on('end', () => console.log('⚠️ Redis client connection closed'));
    
    subClient.on('error', (err) => console.error('❌ Redis subscriber error:', err));
    subClient.on('connect', () => console.log('✅ Redis subscriber connected'));
    subClient.on('ready', () => console.log('✅ Redis subscriber ready'));
    subClient.on('end', () => console.log('⚠️ Redis subscriber connection closed'));
    
    pubClient.on('error', (err) => console.error('❌ Redis publisher error:', err));
    pubClient.on('connect', () => console.log('✅ Redis publisher connected'));
    pubClient.on('ready', () => console.log('✅ Redis publisher ready'));
    pubClient.on('end', () => console.log('⚠️ Redis publisher connection closed'));
    
    // Connect all clients
    console.log('⏳ Connecting Redis clients...');
    await mainClient.connect();
    await subClient.connect();
    await pubClient.connect();
    
    console.log('✅ All Redis clients connected');
    
    // Store clients
    client = mainClient;
    subscriber = subClient;
    publisher = pubClient;
    
    // Create commands object
    redisCommands = {
      geoadd: mainClient.geoAdd.bind(mainClient),
      geopos: mainClient.geoPos.bind(mainClient),
      georadius: mainClient.geoRadius.bind(mainClient),
      zrem: mainClient.zRem.bind(mainClient),
      hset: mainClient.hSet.bind(mainClient),
      hmset: mainClient.hSet.bind(mainClient), // Uses hSet in v4
      hgetall: mainClient.hGetAll.bind(mainClient),
      set: mainClient.set.bind(mainClient),
      get: mainClient.get.bind(mainClient),
      expire: mainClient.expire.bind(mainClient),
      del: mainClient.del.bind(mainClient),
      publish: pubClient.publish.bind(pubClient)
    };
    
    console.log('✅ Redis commands prepared');
    
    // Verify connection with a ping
    try {
      console.log('⏳ Sending PING to verify connection...');
      const pingResult = await mainClient.ping();
      console.log(`✅ Redis PING successful, response: ${pingResult}`);
    } catch (pingError) {
      console.error('❌ Redis connection verification failed:', pingError);
      throw pingError;
    }
    
    // Reset reconnect counter on successful connection
    reconnectAttempts = 0;
    isConnecting = false;
    
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Redis:', error);
    
    isConnecting = false;
    
    // Try to reconnect if we haven't exceeded the limit
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      console.log(`🔄 Will retry Redis connection in ${RECONNECT_DELAY}ms...`);
      setTimeout(() => {
        initRedis(config).catch(err => console.error('❌ Retry connection failed:', err));
      }, RECONNECT_DELAY);
    } else {
      console.error(`❌ Maximum Redis reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`);
    }
    
    throw error;
  }
};

// Safely execute a Redis command with reconnection attempt
const executeRedisCommand = async (commandName, operation) => {
  try {
    await ensureRedisConnection();
    return await operation();
  } catch (error) {
    // Handle client closed error by attempting reconnection once
    if (error.name === 'ClientClosedError' || error.message.includes('client is closed')) {
      console.warn(`⚠️ Redis client closed during ${commandName}, attempting to reconnect...`);
      await initRedis();
      // Retry the operation once after reconnection
      return await operation();
    }
    throw error;
  }
};

// Store a user's position using Redis GEO commands
const storeUserPosition = async (userId, longitude, latitude) => {
  return executeRedisCommand('storeUserPosition', async () => {
    if (!client || !client.isReady) {
      throw new Error('Redis not initialized');
    }
    
    // Use GEOADD to store the position
    await redisCommands.geoadd(KEYS.USER_POSITIONS, [
      { longitude, latitude, member: userId }
    ]);
    
    // Also store individual position with expiry
    const positionKey = `${KEYS.USER_POSITION_KEY}${userId}`;
    const positionData = JSON.stringify({ longitude, latitude });
    
    await redisCommands.set(positionKey, positionData);
    await redisCommands.expire(positionKey, POSITION_EXPIRY);
    
    // Publish an update to notify subscribers
    const updateData = JSON.stringify({ 
      userId,
      location: { longitude, latitude },
      timestamp: Date.now()
    });
    
    await redisCommands.publish(KEYS.USER_UPDATE_CHANNEL, updateData);
    
    return true;
  });
};

// Store additional user details in a Redis hash
const storeUserDetails = async (userId, details) => {
  return executeRedisCommand('storeUserDetails', async () => {
    if (!client || !client.isReady) {
      throw new Error('Redis not initialized');
    }

    const key = `${KEYS.USER_DETAILS}${userId}`;
    const data = {
      ...details,
      lastUpdate: Date.now().toString(),
    };
    
    await redisCommands.hmset(key, data);
    
    return true;
  });
};

// Get user position
const getUserPosition = async (userId) => {
  return executeRedisCommand('getUserPosition', async () => {
    if (!client || !client.isReady) {
      throw new Error('Redis not initialized');
    }
    
    // Check individual position key first (which has TTL)
    const positionKey = `${KEYS.USER_POSITION_KEY}${userId}`;
    const positionData = await redisCommands.get(positionKey);
    
    if (positionData) {
      return JSON.parse(positionData);
    }
    
    // Fallback to geo position
    const positions = await redisCommands.geopos(KEYS.USER_POSITIONS, [userId]);
    
    // If user doesn't exist or has no position, return null
    if (!positions || !positions[0]) {
      return null;
    }
    
    // Redis returns [longitude, latitude]
    return {
      longitude: parseFloat(positions[0][0]),
      latitude: parseFloat(positions[0][1])
    };
  });
};

// Get user details
const getUserDetails = async (userId) => {
  return executeRedisCommand('getUserDetails', async () => {
    if (!client || !client.isReady) {
      throw new Error('Redis not initialized');
    }
    
    const key = `${KEYS.USER_DETAILS}${userId}`;
    return await redisCommands.hgetall(key);
  });
};

// Find users within a radius (in meters) of a given position
const findNearbyUsers = async (longitude, latitude, radius) => {
  return executeRedisCommand('findNearbyUsers', async () => {
    if (!client || !client.isReady) {
      throw new Error('Redis not initialized');
    }
    
    const options = {
      WITHCOORD: true,   // Return coordinates
      WITHDIST: true,    // Return distance from center
      unit: 'm',         // Distance in meters
    };
    
    // Use GEORADIUS to find nearby users
    const nearbyUsers = await redisCommands.georadius(
      KEYS.USER_POSITIONS, 
      longitude, 
      latitude, 
      radius, 
      options
    );
    
    // Process and return user data
    return Promise.all(nearbyUsers.map(async (data) => {
      const userId = data.member;
      const distance = parseFloat(data.distance);
      const coords = data.coordinates;
      
      // Get additional user details
      const details = await getUserDetails(userId);
      
      return {
        userId,
        distance,
        location: {
          longitude: parseFloat(coords.longitude),
          latitude: parseFloat(coords.latitude)
        },
        ...details
      };
    }));
  });
};

// Subscribe to user position updates
const subscribeToUserUpdates = (callback) => {
  if (!subscriber || !subscriber.isReady) {
    console.error('❌ Cannot subscribe: Redis subscriber not initialized');
    throw new Error('Redis not initialized');
  }
  
  try {
    console.log(`✅ Subscribing to ${KEYS.USER_UPDATE_CHANNEL} channel`);
    
    subscriber.subscribe(KEYS.USER_UPDATE_CHANNEL, (message) => {
      try {
        const data = JSON.parse(message);
        callback(data);
      } catch (error) {
        console.error('❌ Error parsing Redis message:', error);
      }
    });
    
    return () => {
      console.log(`🔄 Unsubscribing from ${KEYS.USER_UPDATE_CHANNEL} channel`);
      try {
        subscriber.unsubscribe(KEYS.USER_UPDATE_CHANNEL);
      } catch (error) {
        console.error('❌ Error unsubscribing:', error);
      }
    };
  } catch (error) {
    console.error('❌ Error subscribing to Redis channel:', error);
    throw error;
  }
};

// Remove user data when they disconnect
const removeUserPosition = async (userId) => {
  return executeRedisCommand('removeUserPosition', async () => {
    if (!client || !client.isReady) {
      throw new Error('Redis not initialized');
    }
    
    // Remove from geospatial index
    await redisCommands.zrem(KEYS.USER_POSITIONS, userId);
    
    // Remove individual position key
    const positionKey = `${KEYS.USER_POSITION_KEY}${userId}`;
    await redisCommands.del(positionKey);
    
    // Publish removal event
    const updateData = JSON.stringify({ 
      userId,
      type: 'removal',
      timestamp: Date.now()
    });
    
    await redisCommands.publish(KEYS.USER_UPDATE_CHANNEL, updateData);
    
    return true;
  });
};

// Check if Redis is connected
const isRedisConnected = () => {
  return client && client.isReady;
};

module.exports = {
  initRedis,
  storeUserPosition,
  storeUserDetails,
  getUserPosition,
  getUserDetails,
  findNearbyUsers,
  subscribeToUserUpdates,
  removeUserPosition,
  isRedisConnected,
  KEYS,
  POSITION_EXPIRY
}; 