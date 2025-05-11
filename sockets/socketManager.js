const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { getUserById } = require('../userService');
const { verifyToken } = require('../authService');
const redisService = require('../services/redisService');
const chatService = require('../services/chatService');

// In-memory cache for active socket connections by user ID
const activeConnections = new Map();

// Initialize Redis when this module is loaded
let redisInitialized = false;
const initRedisConnection = async () => {
  console.log('⏳ Attempting to initialize Redis for socket manager...');
  if (!redisInitialized) {
    try {
      // Check if Redis is already connected
      if (redisService.isRedisConnected()) {
        console.log('✅ Redis already connected, skipping initialization');
        redisInitialized = true;
        return;
      }
      
      // Initialize Redis
      await redisService.initRedis();
      redisInitialized = true;
      console.log('✅ Redis successfully initialized for socket manager');
    } catch (error) {
      console.error('❌ Failed to initialize Redis for socket manager:', error);
      // Reset initialization flag so we can retry later
      redisInitialized = false;
    }
  } else {
    console.log('ℹ️ Redis already initialized for socket manager');
  }
};

const setupSocketIO = (server) => {
  console.log('⏳ Setting up Socket.IO server...');
  const io = new Server(server, {
    cors: {
      origin: "*", // In production, restrict this to your app's domain
      methods: ["GET", "POST"]
    }
  });
  console.log('✅ Socket.IO server created with CORS configuration');

  // Initialize Redis connection
  initRedisConnection().catch(err => {
    console.error('❌ Error initializing Redis:', err);
  });

  // Set up Redis subscription for user updates
  const setupRedisSubscription = () => {
    console.log('⏳ Setting up Redis subscription for user updates...');
    if (!redisInitialized) {
      console.warn('⚠️ Redis not initialized, skipping subscription setup');
      return;
    }

    // Subscribe to user position updates from Redis
    try {
      const unsubscribe = redisService.subscribeToUserUpdates((data) => {
        try {
          if (data.type === 'removal') {
            // Handle user removal
            console.log(`🔴 User removed from position tracking: ${data.userId}`);
          } else {
            // Handle user position update
            //console.log(`📍 Position update for user: ${data.userId}`);
            
            // Broadcast to all clients
            broadcastUserUpdate(io, data.userId);
          }
        } catch (error) {
          console.error('❌ Error handling Redis user update:', error);
        }
      });
      console.log('✅ Successfully subscribed to Redis user updates');

      // Add cleanup for subscription
      process.on('SIGTERM', () => {
        console.log('🛑 SIGTERM received, unsubscribing from Redis updates');
        unsubscribe();
      });
      process.on('SIGINT', () => {
        console.log('🛑 SIGINT received, unsubscribing from Redis updates');
        unsubscribe();
      });
    } catch (error) {
      console.error('❌ Failed to subscribe to Redis updates:', error);
    }
  };

  // Set up subscription after Redis is initialized
  if (redisInitialized) {
    setupRedisSubscription();
  } else {
    // Retry after a delay if Redis isn't initialized yet
    console.log('⏳ Scheduling Redis subscription setup retry in 5 seconds...');
    setTimeout(() => {
      if (redisInitialized) {
        setupRedisSubscription();
      } else {
        console.warn('⚠️ Redis still not initialized after delay, skipping subscription');
      }
    }, 5000);
  }

  // Socket.IO authentication middleware
  io.use(async (socket, next) => {
    console.log(`⏳ New socket connection attempt, handshake ID: ${socket.id}`);
    console.log(`🔍 Connection details - IP: ${socket.handshake.address}, Transport: ${socket.conn.transport.name}`);
    
    const token = socket.handshake.auth.token;
    
    if (!token) {
      console.warn('❌ Authentication failed: No token provided in handshake');
      return next(new Error('Authentication error: Token required'));
    }
    
    console.log(`🔑 Verifying token for socket: ${socket.id}`);
    console.log(`🔐 Token received length: ${token.length} chars, starts with: ${token.substring(0, 10)}...`);
    
    try {
      // Verify JWT token using our enhanced verifyToken function
      console.log(`⏳ Calling verifyToken function for socket ${socket.id}`);
      const tokenResult = verifyToken(token);
      
      if (!tokenResult.valid) {
        console.error(`❌ Token validation failed for socket ${socket.id}:`, tokenResult.error);
        return next(new Error(`Authentication error: ${tokenResult.error}`));
      }
      
      const decoded = tokenResult.decoded;
      console.log(`✅ Token valid for user ID: ${decoded.userId}`);
      console.log(`📋 Token payload: ${JSON.stringify({
        userId: decoded.userId,
        iat: decoded.iat,
        exp: decoded.exp,
        expiresIn: new Date(decoded.exp * 1000).toISOString()
      })}`);
      
      // Fetch user details
      try {
        console.log(`⏳ Fetching user details for ID: ${decoded.userId}`);
        const user = await getUserById(decoded.userId);
        
        if (!user) {
          console.error(`❌ User not found for ID: ${decoded.userId}`);
          return next(new Error('Authentication error: User not found'));
        }
        
        console.log(`✅ User found in database: ${user.nickname} (ID: ${user.id})`);
        console.log(`📋 User data: ${JSON.stringify({
          id: user.id,
          phoneNumber: user.phoneNumber,
          nickname: user.nickname,
          isActivated: user.isActivated
        })}`);
        
        // Check if user is activated
        if (!user.isActivated) {
          console.error(`❌ Account not activated for user ID: ${decoded.userId}`);
          return next(new Error('Authentication error: Account not activated'));
        }
        
        // Add user data to socket
        socket.userId = user.id;
        socket.phoneNumber = user.phoneNumber;
        socket.username = user.nickname;
        console.log(`🔗 User data attached to socket: userId=${socket.userId}, username=${socket.username}`);
        
        console.log(`✅ Socket auth successful: ${user.nickname} (ID: ${user.id}), socket ID: ${socket.id}`);
        console.log(`⏱️ Auth process completed in ${Date.now() - socket.handshake.issued} ms`);
        next();
      } catch (dbError) {
        console.error(`❌ Database error during socket authentication for user ID ${decoded.userId}:`, dbError);
        return next(new Error('Authentication error: Database error'));
      }
    } catch (error) {
      console.error(`❌ Socket authentication error for socket ${socket.id}:`, error);
      return next(new Error('Authentication error: Invalid token'));
    }
  });

  // Broadcast updated user list to all clients
  const broadcastUserUpdates = async (io) => {
    if (!redisInitialized) {
      console.warn('⚠️ Redis not initialized, skipping broadcast');
      return;
    }

    try {
      // Get all active user IDs from active connections
      const activeUserIds = Array.from(activeConnections.keys());
      // console.log(`📢 Broadcasting updates for ${activeUserIds.length} active connections`);
      
      // Only proceed if there are active users
      if (activeUserIds.length === 0) {
        // console.log('ℹ️ No active users to broadcast');
        return;
      }
      
      // Collect user data (position + details) for all active users
      const activeUsers = await Promise.all(
        activeUserIds.map(async (userId) => {
          try {
            // Get user position from Redis
            // console.log(`⏳ Fetching position for user: ${userId}`);
            const position = await redisService.getUserPosition(userId);
            // console.log(`${position ? '✅' : '❌'} Position for ${userId}: ${JSON.stringify(position)}`);
            
            // Get user details from Redis
            // console.log(`⏳ Fetching details for user: ${userId}`);
            const details = await redisService.getUserDetails(userId);
            // console.log(`${details ? '✅' : '❌'} Details for ${userId}: ${JSON.stringify(details)}`);
            
            // Only include users who have a position
            if (details && position) {
              return {
                id: userId,
                name: details.name || 'Unknown',
                location: position,
                lastUpdate: details.lastUpdate || Date.now()
              };
            }
            // console.log(`⚠️ User ${userId} missing position or details, excluding from broadcast`);
            return null;
          } catch (err) {
            console.error(`❌ Error fetching data for active user ${userId}:`, err);
            return null;
          }
        })
      );
      
      // Filter out null entries and broadcast
      const filteredUsers = activeUsers.filter(user => user !== null);
      // console.log(`📢 Broadcasting ${filteredUsers.length} active users with positions`);
      io.emit('users_update', filteredUsers);
    } catch (error) {
      console.error('❌ Error broadcasting user updates:', error);
    }
  };

  // Broadcast a specific user update
  const broadcastUserUpdate = async (io, userId) => {
    if (!redisInitialized) {
      console.warn('⚠️ Redis not initialized, skipping single user broadcast');
      return;
    }

    try {
      //console.log(`📢 Broadcasting update for specific user: ${userId}`);
      // Always broadcast full user list to keep client logic simple
      await broadcastUserUpdates(io);
    } catch (error) {
      console.error(`❌ Error broadcasting update for user ${userId}:`, error);
    }
  };

  /* Function to get users with DMs enabled
  const getUsersWithDmsEnabled = async (userIds) => {
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return [];
    }
    
    console.log(`⏳ Checking DM status for ${userIds.length} users`);
    
    try {
      const { getUserById } = require('../userService');
      
      // Get DM status for each user
      const userDmStatuses = await Promise.all(
        userIds.map(async (userId) => {
          try {
            const user = await getUserById(userId);
            if (!user) {
              console.log(`⚠️ User ${userId} not found when checking DM status`);
              return null;
            }
            
            return {
              userId: user.id,
              enableDms: user.enableDms || false,
              isOnline: activeConnections.has(user.id)
            };
          } catch (error) {
            console.error(`❌ Error checking DM status for user ${userId}:`, error);
            return null;
          }
        })
      );
      
      // Filter out null values and return
      const validStatuses = userDmStatuses.filter(status => status !== null);
      console.log(`✅ Found DM status for ${validStatuses.length} users`);
      return validStatuses;
    } catch (error) {
      console.error('❌ Error getting users with DMs enabled:', error);
      return [];
    }
  };*/

  // Socket.IO connection handler
  io.on('connection', async (socket) => {
    console.log(`🟢 User connected: ${socket.username} (ID: ${socket.userId}), socket ID: ${socket.id}`);
    
    // Store socket connection in memory map
    activeConnections.set(socket.userId, socket);
    console.log(`📊 Active connections: ${activeConnections.size}`);
    
    // Check and deliver any pending messages for this user
    const deliveredCount = deliverPendingMessages(socket.userId);
    if (deliveredCount > 0) {
      console.log(`Delivered ${deliveredCount} pending messages to user ${socket.userId} on connect`);
    }
    
    // Store user details in Redis
    if (redisInitialized) {
      console.log(`⏳ Storing user details in Redis for: ${socket.userId}`);
      try {
        await redisService.storeUserDetails(socket.userId, {
          name: socket.username,
          phoneNumber: socket.phoneNumber,
          connectionTime: Date.now()
        });
        console.log(`✅ User details stored in Redis for: ${socket.userId}`);
      } catch (error) {
        console.error(`❌ Failed to store user details in Redis for ${socket.userId}:`, error);
      }
    }
    
    // Emit authenticated event to the client
    console.log(`📤 Emitting 'authenticated' event to socket: ${socket.id}`);
    socket.emit('authenticated', {
      userId: socket.userId,
      username: socket.username
    });
    
    // Broadcast active users to the newly connected client
    console.log(`📢 Broadcasting active users to newly connected client: ${socket.id}`);
    broadcastUserUpdates(io);
    
    // Handle location updates
    socket.on('update_location', async (data) => {
      // console.log(`📍 Received location update from ${socket.userId}: ${JSON.stringify(data)}`);
      if (!data || !data.latitude || !data.longitude) {
        console.warn(`⚠️ Invalid location data from ${socket.userId}: ${JSON.stringify(data)}`);
        return;
      }
      
      if (redisInitialized) {
        // console.log(`⏳ Storing position for ${socket.userId}: ${data.longitude}, ${data.latitude}`);
        try {
          // Store the position in Redis - this will trigger a pub/sub event
          await redisService.storeUserPosition(
            socket.userId,
            data.longitude,
            data.latitude
          );
          
          // Update last update timestamp
          await redisService.storeUserDetails(socket.userId, {
            lastUpdate: Date.now()
          });
          // console.log(`✅ Position stored for ${socket.userId}`);
        } catch (error) {
          console.error(`❌ Failed to store position for ${socket.userId}:`, error);
        }
      } else {
        console.warn(`⚠️ Redis not initialized, can't store position for ${socket.userId}`);
      }
    });
    
    // Handle direct messages between users
    socket.on('send_message', async (data) => {
      console.log(`💬 Message from ${socket.userId} to ${data.recipientId}: ${data.message?.substring(0, 20)}${data.message?.length > 20 ? '...' : ''}`);
      
      const { recipientId, message, messageId } = data;
      
      if (!recipientId || !message) {
        console.warn(`⚠️ Invalid message data from ${socket.userId}`);
        socket.emit('message_status', { 
          messageId,
          status: 'error'
        });
        return;
      }
      
      try {
        // Check if recipient exists
        const targetId = parseInt(recipientId, 10);
        if (isNaN(targetId)) {
          console.warn(`⚠️ Invalid recipient ID from ${socket.userId}: ${recipientId}`);
          socket.emit('message_status', { 
            messageId,
            status: 'error'
          });
          return;
        }
        
        // Prevent messaging self
        if (targetId === socket.userId) {
          console.warn(`⚠️ User ${socket.userId} attempted to message themselves`);
          socket.emit('message_status', { 
            messageId,
            status: 'error',
            error: 'Cannot send messages to yourself'
          });
          return;
        }
        
        // Get the recipient socket
        const recipientSocket = activeConnections.get(targetId);
        
        // Create message payload with unique ID if not provided
        const finalMessageId = messageId || `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const messagePayload = {
          messageId: finalMessageId,
          senderId: socket.userId,
          recipientId: targetId,
          message,
          timestamp: Date.now(),
          status: 'pending'
        };
        
        // Track this chat session
        chatService.trackChatSession(socket.userId, targetId);
        
        // Check if recipient is connected
        if (recipientSocket) {
          // Set status to delivered
          messagePayload.status = 'delivered';
          
          // Send the message to recipient
          console.log(`📤 Sending message from ${socket.username} (${socket.userId}) to user ${targetId}`);
          recipientSocket.emit('new_message', messagePayload);
          
          // Send delivery confirmation to sender
          socket.emit('message_status', { 
            messageId: finalMessageId,
            status: 'delivered'
          });
          
          console.log(`✅ Message from ${socket.userId} to ${targetId} delivered successfully`);
        } else {
          // Recipient is offline, queue the message for retry
          console.log(`⏳ Recipient ${targetId} is offline, queueing message for retry`);
          
          // Store in pending messages with 5-minute expiration
          pendingMessages.set(finalMessageId, {
            messageId: finalMessageId,
            senderId: socket.userId,
            recipientId: targetId,
            message,
            timestamp: messagePayload.timestamp,
            expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
          });
          
          // Tell sender message is pending
          socket.emit('message_status', { 
            messageId: finalMessageId,
            status: 'pending',
            message: 'Recipient is offline, will retry delivery for 5 minutes'
          });
          
          // Schedule periodic retries
          const attemptDelivery = () => {
            // If message no longer in pending, it was either delivered or expired
            if (!pendingMessages.has(finalMessageId)) return;
            
            // Get the most current socket reference
            const currentRecipientSocket = activeConnections.get(targetId);
            if (currentRecipientSocket) {
              // Found the recipient, deliver the message
              console.log(`📤 Retrying delivery of message ${finalMessageId} to ${targetId}`);
              
              const pendingMessage = pendingMessages.get(finalMessageId);
              currentRecipientSocket.emit('new_message', {
                messageId: pendingMessage.messageId,
                senderId: pendingMessage.senderId,
                recipientId: pendingMessage.recipientId,
                message: pendingMessage.message,
                timestamp: pendingMessage.timestamp,
                status: 'delivered'
              });
              
              // Notify sender if they're still connected
              if (activeConnections.has(pendingMessage.senderId)) {
                activeConnections.get(pendingMessage.senderId).emit('message_status', {
                  messageId: pendingMessage.messageId,
                  status: 'delivered'
                });
              }
              
              // Remove from pending
              pendingMessages.delete(finalMessageId);
              console.log(`✅ Message ${finalMessageId} delivered successfully on retry`);
            }
          };
          
          // Try delivery every 30 seconds for up to 5 minutes
          const retryCount = 10; // 10 retries * 30 seconds = 5 minutes
          for (let i = 1; i <= retryCount; i++) {
            setTimeout(attemptDelivery, i * 30000); // 30 seconds between attempts
          }
        }
      } catch (error) {
        console.error(`❌ Error sending message from ${socket.userId} to ${recipientId}:`, error);
        socket.emit('message_status', { 
          messageId,
          status: 'error'
        });
      }
    });
    
    // Handle message "seen" notifications
    socket.on('message_seen', (data) => {
      console.log(`👁️ Message ${data.messageId} marked as seen by ${socket.userId}`);
      
      const { messageId, senderId } = data;
      
      if (!messageId || !senderId) {
        console.warn(`⚠️ Invalid message_seen data from ${socket.userId}`);
        return;
      }
      
      try {
        const senderSocket = activeConnections.get(parseInt(senderId, 10));
        if (senderSocket) {
          senderSocket.emit('message_seen', {
            messageId,
            seenBy: socket.userId
          });
          console.log(`✅ Sent seen notification to ${senderId} for message ${messageId}`);
        } else {
          console.log(`⚠️ Sender ${senderId} is not connected, can't send seen notification`);
        }
      } catch (error) {
        console.error(`❌ Error processing message_seen for message ${messageId}:`, error);
      }
    });
    
    // Handle specific stop_location_sharing event
    socket.on('stop_location_sharing', async () => {
      console.log(`🛑 User ${socket.userId} requested to stop location sharing`);
      if (redisInitialized) {
        try {
          // Remove user position from Redis
          // console.log(`⏳ Removing position for ${socket.userId} from Redis`);
          await redisService.removeUserPosition(socket.userId);
          // console.log(`✅ Position removed for ${socket.userId}`);
          
          // Broadcast updates to reflect the change
          broadcastUserUpdates(io);
          
          // Close the socket connection
          console.log(`🔌 Disconnecting socket for ${socket.userId} as requested`);
          socket.disconnect(true);
        } catch (error) {
          console.error(`❌ Error processing stop_location_sharing for ${socket.userId}:`, error);
        }
      } else {
        console.warn(`⚠️ Redis not initialized, can't remove position for ${socket.userId}`);
      }
    });
    
    /* Handle client requesting DM-enabled users
    socket.on('get_dm_enabled_users', async (data) => {
      console.log(`⏳ User ${socket.userId} requested DM-enabled users`);
      
      try {
        // Get list of user IDs to check (from data or use all active users)
        const userIdsToCheck = data && data.userIds ? data.userIds : 
          Array.from(activeConnections.keys()).filter(id => id !== socket.userId);
        
        console.log(`⏳ Checking DM status for ${userIdsToCheck.length} users`);
        const dmEnabledUsers = await getUsersWithDmsEnabled(userIdsToCheck);
        
        // Send the list back to the client
        socket.emit('dm_enabled_users', {
          users: dmEnabledUsers
        });
        
        console.log(`✅ Sent DM status for ${dmEnabledUsers.length} users to user ${socket.userId}`);
      } catch (error) {
        console.error(`❌ Error processing get_dm_enabled_users for user ${socket.userId}:`, error);
        socket.emit('dm_enabled_users', { 
          error: 'Error retrieving DM status',
          users: [] 
        });
      }
    });*/
    
    // Handle disconnection
    socket.on('disconnect', async (reason) => {
      console.log(`🔴 User disconnected: ${socket.username} (ID: ${socket.userId}), socket ID: ${socket.id}, reason: ${reason}`);
      
      // Clean up chat sessions for this user
      chatService.cleanupUserSessions(socket.userId);
      
      // Remove from active connections
      activeConnections.delete(socket.userId);
      console.log(`📊 Active connections after disconnect: ${activeConnections.size}`);
      
      if (redisInitialized) {
        try {
          // Remove user position from Redis
          // console.log(`⏳ Removing position for ${socket.userId} due to disconnect`);
          await redisService.removeUserPosition(socket.userId);
          
          // Update user details to record disconnection time only
          console.log(`⏳ Updating user details for ${socket.userId} with disconnection time`);
          await redisService.storeUserDetails(socket.userId, {
            disconnectionTime: Date.now()
          });
          console.log(`✅ User ${socket.userId} disconnect time recorded in Redis`);
        } catch (error) {
          console.error(`❌ Error handling disconnect cleanup for ${socket.userId}:`, error);
        }
      } else {
        console.warn(`⚠️ Redis not initialized, can't clean up data for ${socket.userId}`);
      }
      
      // Broadcast updated user list
      broadcastUserUpdates(io);
    });
  });

  console.log('✅ Socket.IO server setup complete');
  return io;
};

// Export the setup function and active users getter
module.exports = {
  setupSocketIO,
  getActiveUsers: async () => {
    if (!redisInitialized) {
      console.warn('⚠️ Redis not initialized, returning empty active users list');
      return [];
    }
    
    try {
      // Get all user IDs from active connections
      const activeUserIds = Array.from(activeConnections.keys());
      // console.log(`📊 Fetching active user data for ${activeUserIds.length} connections`);
      
      // Collect user data for all active users
      const activeUsers = await Promise.all(
        activeUserIds.map(async (userId) => {
          try {
            const position = await redisService.getUserPosition(userId);
            const details = await redisService.getUserDetails(userId);
            
            // Get additional user details from the database
            const { getUserById } = require('../userService');
            const userDetails = await getUserById(userId);
            
            if (details && position) {
              return {
                userId: userId,
                id: userId,
                name: details.name || userDetails?.nickname || 'Unknown',
                nickname: details.name || userDetails?.nickname || 'Unknown',
                enableDms: userDetails?.enableDms || false,
                location: position,
                lastUpdate: details.lastUpdate || Date.now()
              };
            }
            return null;
          } catch (err) {
            console.error(`❌ Error fetching data for active user ${userId}:`, err);
            return null;
          }
        })
      );
      
      // Filter out null entries
      const filteredUsers = activeUsers.filter(user => user !== null);
      // console.log(`📊 Returning ${filteredUsers.length} active users with positions`);
      return filteredUsers;
    } catch (error) {
      console.error('❌ Error getting active users:', error);
      return [];
    }
  }
};

// Track pending messages for offline users (messageId -> message data)
const pendingMessages = new Map();

// Clear expired pending messages
setInterval(() => {
  const now = Date.now();
  for (const [messageId, data] of pendingMessages.entries()) {
    if (now > data.expiresAt) {
      console.log(`Message ${messageId} expired after retry period`);
      // Notify sender that message delivery failed
      if (activeConnections.has(data.senderId)) {
        activeConnections.get(data.senderId).emit('message_status', {
          messageId: data.messageId,
          status: 'failed',
          error: 'Recipient remained offline'
        });
      }
      pendingMessages.delete(messageId);
    }
  }
}, 30000); // Check every 30 seconds

// Try to deliver pending messages when users connect
function deliverPendingMessages(userId) {
  let delivered = 0;
  
  for (const [messageId, data] of pendingMessages.entries()) {
    if (data.recipientId === userId) {
      const recipientSocket = activeConnections.get(userId);
      if (recipientSocket) {
        // Found the recipient, deliver the message
        recipientSocket.emit('new_message', {
          messageId: data.messageId,
          senderId: data.senderId,
          recipientId: data.recipientId,
          message: data.message,
          timestamp: data.timestamp,
          status: 'delivered'
        });
        
        // Notify sender if they're still connected
        if (activeConnections.has(data.senderId)) {
          activeConnections.get(data.senderId).emit('message_status', {
            messageId: data.messageId,
            status: 'delivered'
          });
        }
        
        // Remove from pending
        pendingMessages.delete(messageId);
        delivered++;
      }
    }
  }
  
  if (delivered > 0) {
    console.log(`Delivered ${delivered} pending messages to user ${userId}`);
  }
  
  return delivered;
}