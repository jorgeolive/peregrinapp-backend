/**
 * Chat Service
 * Provides utility functions for the real-time chat system
 * Note: Messages are not stored on the server - only delivered in real-time
 */

const { getUserById } = require('../userService');
const redisService = require('./redisService');

// Track active chat sessions (userId -> Set of active chat partner IDs)
const activeChatSessions = new Map();

// Format message object for client consumption
function formatMessage(senderId, senderName, recipientId, message, messageId = null) {
  return {
    messageId: messageId || `msg_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    senderId,
    recipientId,
    message,
    timestamp: Date.now(),
    status: 'delivered'
  };
}

// Validate message content
function validateMessage(message) {
  if (!message || typeof message !== 'string') {
    return { valid: false, error: 'Message must be a non-empty string' };
  }
  
  if (message.length > 2000) {
    return { valid: false, error: 'Message exceeds maximum length of 2000 characters' };
  }
  
  return { valid: true };
}

// Check if user can receive messages
async function canReceiveMessages(userId) {
  try {
    const user = await getUserById(userId);
    if (!user) {
      return { allowed: false, reason: 'user_not_found' };
    }
    
    if (!user.isActivated) {
      return { allowed: false, reason: 'user_not_activated' };
    }
    
    if (!user.enableDms) {
      return { allowed: false, reason: 'dms_disabled' };
    }
    
    return { allowed: true };
  } catch (error) {
    console.error(`Error checking if user ${userId} can receive messages:`, error);
    return { allowed: false, reason: 'server_error' };
  }
}

// Track active chat session
function trackChatSession(userId1, userId2) {
  // Get or create set for user1
  if (!activeChatSessions.has(userId1)) {
    activeChatSessions.set(userId1, new Set());
  }
  
  // Get or create set for user2
  if (!activeChatSessions.has(userId2)) {
    activeChatSessions.set(userId2, new Set());
  }
  
  // Add users to each other's active chats
  activeChatSessions.get(userId1).add(userId2);
  activeChatSessions.get(userId2).add(userId1);
  
  console.log(`Chat session tracked between users ${userId1} and ${userId2}`);
}

// Get active chat sessions for a user
function getUserActiveSessions(userId) {
  if (!activeChatSessions.has(userId)) {
    return [];
  }
  
  return Array.from(activeChatSessions.get(userId));
}

// Check if users have an active chat session
function hasActiveChatSession(userId1, userId2) {
  if (!activeChatSessions.has(userId1)) {
    return false;
  }
  
  return activeChatSessions.get(userId1).has(userId2);
}

// End a chat session between users
function endChatSession(userId1, userId2) {
  if (activeChatSessions.has(userId1)) {
    activeChatSessions.get(userId1).delete(userId2);
  }
  
  if (activeChatSessions.has(userId2)) {
    activeChatSessions.get(userId2).delete(userId1);
  }
  
  console.log(`Chat session ended between users ${userId1} and ${userId2}`);
}

// Clean up chat sessions when a user disconnects
function cleanupUserSessions(userId) {
  if (!activeChatSessions.has(userId)) {
    return;
  }
  
  // Get all users that had a session with this user
  const partnerIds = Array.from(activeChatSessions.get(userId));
  
  // Remove user from all partner's sessions
  for (const partnerId of partnerIds) {
    if (activeChatSessions.has(partnerId)) {
      activeChatSessions.get(partnerId).delete(userId);
    }
  }
  
  // Delete user's sessions
  activeChatSessions.delete(userId);
  
  console.log(`Cleaned up ${partnerIds.length} chat sessions for user ${userId}`);
}

module.exports = {
  formatMessage,
  validateMessage,
  canReceiveMessages,
  trackChatSession,
  getUserActiveSessions,
  hasActiveChatSession,
  endChatSession,
  cleanupUserSessions
}; 