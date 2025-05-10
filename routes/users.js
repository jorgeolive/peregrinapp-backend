const express = require('express');
const router = express.Router();
const { 
  addUser, 
  getUserByPhoneNumber, 
  verifyUserPassword, 
  activateUser,
  resendActivationCode,
  updateUserPreferences,
  getUserById
} = require('../userService');
const { authenticateJWT, requireActivated, generateToken } = require('../authService');
const { getActiveUsers } = require('../sockets/socketManager');
const { Pool } = require('pg');
const pool = new Pool();
const chatService = require('../services/chatService');

/**
 * @swagger
 * /peregrinapp/users:
 *   post:
 *     summary: Register a new user
 *     description: Creates a new user account (no authentication required)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - nickname
 *               - password
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: The user's phone number (used as identifier)
 *               nickname:
 *                 type: string
 *                 description: The user's display name
 *               password:
 *                 type: string
 *                 description: User's password
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *                 description: User's date of birth
 *               bio:
 *                 type: string
 *                 description: User's biography or description
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Missing required fields
 *       409:
 *         description: User with this phone number already exists
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  const { phoneNumber, nickname, dateOfBirth, bio, isActivated, password } = req.body;
  
  if (!phoneNumber || !nickname) {
    return res.status(400).json({ error: 'Phone number and nickname are required' });
  }
  
  try {
    const existingUser = await getUserByPhoneNumber(phoneNumber);
    if (existingUser) {
      return res.status(409).json({ error: 'User with this phone number already exists' });
    }
    
    const user = await addUser(phoneNumber, nickname, dateOfBirth, bio, isActivated || false, password);
    res.status(201).json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

/**
 * @swagger
 * /peregrinapp/users/activate:
 *   post:
 *     summary: Activate user account
 *     description: Activates a user account with the provided activation code (no authentication required)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - activationCode
 *             properties:
 *               userId:
 *                 type: integer
 *                 description: The user's ID
 *               activationCode:
 *                 type: string
 *                 description: The activation code sent to the user
 *     responses:
 *       200:
 *         description: User activated successfully
 *       400:
 *         description: Invalid or expired activation code
 *       500:
 *         description: Server error
 */
router.post('/activate', async (req, res) => {
  const { phoneNumber, activationCode } = req.body;
  
  if (!phoneNumber || !activationCode) {
    return res.status(400).json({ error: 'phoneNumber and activation code are required' });
  }
  
  try {
    const result = await activateUser(phoneNumber, activationCode);
    
    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /peregrinapp/users/resend-code:
 *   post:
 *     summary: Resend activation code
 *     description: Sends a new activation code to the user (no authentication required)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: integer
 *                 description: The user's ID
 *     responses:
 *       200:
 *         description: Activation code sent successfully
 *       400:
 *         description: User not found or already activated
 *       500:
 *         description: Server error
 */
router.post('/resend-code', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  
  try {
    const result = await resendActivationCode(userId);
    
    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /peregrinapp/users/profile:
 *   put:
 *     summary: Update user profile
 *     description: Updates the user's profile information and preferences (requires authentication)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enableDms:
 *                 type: boolean
 *                 description: Whether to enable direct messages
 *               bio:
 *                 type: string
 *                 description: User's biography or personal description
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       400:
 *         description: At least one property must be provided
 *       401:
 *         description: Authorization token required
 *       403:
 *         description: Invalid or expired token
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.put('/profile', authenticateJWT, async (req, res) => {
  const { enableDms, bio } = req.body;
  const userId = req.user.userId; // Using userId from the JWT token
  
  console.log(`Updating profile for user ID: ${userId}`);
  
  // Make sure at least one property is provided
  if (enableDms === undefined && bio === undefined) {
    console.log(`Profile update failed: No properties provided for user ID: ${userId}`);
    return res.status(400).json({ error: 'At least one property must be provided' });
  }
  
  try {
    // Get current user to access current values
    const currentUser = await getUserById(userId);
    if (!currentUser) {
      console.log(`Profile update failed: User not found with ID: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Use provided values or fall back to current values
    const updatedEnableDms = enableDms !== undefined ? enableDms : currentUser.enableDms;
    const updatedBio = bio !== undefined ? bio : currentUser.bio;
    
    console.log(`Updating user preferences for ID: ${userId}`);
    // Update the user profile
    const updatedUser = await updateUserPreferences(
      userId, 
      updatedEnableDms,
      updatedBio
    );
    
    console.log(`Profile updated successfully for user ID: ${userId}`);
    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (err) {
    console.error(`Error updating profile for user ID: ${userId}`, err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /peregrinapp/users/login:
 *   post:
 *     summary: User login
 *     description: Authenticates a user and returns a JWT token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - password
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: The user's phone number
 *               password:
 *                 type: string
 *                 description: The user's password
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Server error
 */
router.post('/login', async (req, res) => {
  const { phoneNumber, password } = req.body;
  
  console.log(`Login attempt for phone number: ${phoneNumber}`);
  
  if (!phoneNumber || !password) {
    console.log(`Login failed: Missing required fields for phone number: ${phoneNumber}`);
    return res.status(400).json({ error: 'Phone number and password are required' });
  }
  
  try {
    console.log(`Verifying password for phone number: ${phoneNumber}`);
    const passwordCheck = await verifyUserPassword(phoneNumber, password);
    if (!passwordCheck.valid) {
      console.log(`Login failed: Invalid credentials for phone number: ${phoneNumber}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    console.log(`Password verified successfully for phone number: ${phoneNumber}, user ID: ${passwordCheck.userId}`);
    const user = await getUserById(passwordCheck.userId);
    
    if (!user) {
      console.log(`Login failed: User not found for ID: ${passwordCheck.userId}`);
      return res.status(404).json({ error: 'User account not found' });
    }
    
    if (!user.isActivated) {
      console.log(`Login failed: Account not activated for phone number: ${phoneNumber}`);
      return res.status(403).json({ error: 'Account not activated. Please activate your account first.' });
    }
    
    // Generate JWT token
    console.log(`Generating JWT token for user ID: ${user.id}`);
    const token = generateToken(user);
    
    // Get user's current position if available
    let userPosition = null;
    try {
      // This would be replaced with your actual position retrieval logic
      const activeUsers = getActiveUsers();
      const activeUser = activeUsers.find(u => u.userId === user.id);
      if (activeUser && activeUser.position) {
        userPosition = activeUser.position;
        console.log(`Retrieved position for user ID: ${user.id}`);
      }
    } catch (posErr) {
      console.error(`Failed to retrieve position for user ID: ${user.id}`, posErr);
      // Continue without position - non-critical error
    }
    
    // Prepare complete user details
    const userDetails = {
      id: user.id,
      phoneNumber: user.phoneNumber,
      nickname: user.nickname,
      dateOfBirth: user.dateOfBirth,
      bio: user.bio,
      isActivated: user.isActivated,
      enableDms: user.enableDms,
      createdAt: user.createdAt,
      position: userPosition,
      // Add any other relevant user details here
    };
    
    console.log(`Login successful for phone number: ${phoneNumber}`);
    res.json({ 
      message: 'Login successful',
      user: userDetails,
      token
    });
  } catch (err) {
    console.error(`Login error for phone number: ${phoneNumber}`, err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user profile
router.get('/profile', authenticateJWT, async (req, res) => {
  try {
    // req.user contains the decoded JWT payload added by the middleware
    const user = await getUserById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /peregrinapp/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     description: Retrieves limited user details by ID (requires authentication)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The user's ID
 *     responses:
 *       200:
 *         description: User details
 *       401:
 *         description: Unauthorized - authentication required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.get('/:id', authenticateJWT, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  
  console.log(`Request for user profile with ID: ${userId} by user: ${req.user.userId}`);
  
  if (isNaN(userId)) {
    console.log(`Invalid user ID format: ${req.params.id}`);
    return res.status(400).json({ error: 'Invalid user ID format' });
  }
  
  try {
    console.log(`Fetching user data for ID: ${userId}`);
    const user = await getUserById(userId);
    
    if (!user) {
      console.log(`User not found with ID: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log(`Successfully retrieved user data for ID: ${userId}`);
    
    // Return only specific fields
    res.json({
      id: user.id,
      name: user.nickname,
      bio: user.bio,
      enableDms: user.enableDms
    });
  } catch (err) {
    console.error(`Error retrieving user with ID: ${userId}`, err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /peregrinapp/users/chat-contacts:
 *   get:
 *     summary: Get available chat contacts
 *     description: Retrieves users who have DMs enabled and are available for chat
 *     tags: [Users, Chat]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of available chat contacts
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Server error
 */
router.get('/chat-contacts', authenticateJWT, async (req, res) => {
  const currentUserId = req.user.userId;
  
  console.log(`Fetching chat contacts for user: ${currentUserId}`);
  
  try {
    // Get active users from Socket Manager
    const activeUsers = getActiveUsers();
    
    // Get all users who have DMs enabled from database
    const allUsers = await pool.query(
      `SELECT id, nickname, bio, enable_dms
       FROM peregrinapp.users
       WHERE is_activated = TRUE AND id != $1`,
      [currentUserId]
    );
    
    // Filter to only include users who have DMs enabled
    const chatContacts = allUsers.rows
      .filter(user => user.enable_dms)
      .map(user => {
        // Find if the user is active/online
        const activeUser = activeUsers.find(active => active.userId === user.id || active.id === user.id);
        
        return {
          id: user.id,
          name: user.nickname,
          bio: user.bio || '',
          isOnline: !!activeUser,
          lastActive: activeUser ? activeUser.lastUpdate : null
        };
      });
    
    console.log(`Returning ${chatContacts.length} chat contacts for user: ${currentUserId}`);
    res.json(chatContacts);
    
  } catch (err) {
    console.error(`Error fetching chat contacts for user ${currentUserId}:`, err);
    res.status(500).json({ error: 'Error retrieving chat contacts' });
  }
});

/**
 * @swagger
 * /peregrinapp/users/active-chats:
 *   get:
 *     summary: Get active chat sessions
 *     description: Retrieves users with whom the current user has active chat sessions
 *     tags: [Users, Chat]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active chat partners
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Server error
 */
router.get('/active-chats', authenticateJWT, async (req, res) => {
  const currentUserId = req.user.userId;
  
  console.log(`Fetching active chat sessions for user: ${currentUserId}`);
  
  try {
    // Get active chat sessions
    const activeSessions = chatService.getUserActiveSessions(currentUserId);
    
    if (!activeSessions || activeSessions.length === 0) {
      console.log(`No active chat sessions for user: ${currentUserId}`);
      return res.json([]);
    }
    
    console.log(`Found ${activeSessions.length} active chat sessions for user: ${currentUserId}`);
    
    // Get details for each user in an active session
    const sessionDetails = await Promise.all(
      activeSessions.map(async (partnerId) => {
        try {
          const partner = await getUserById(partnerId);
          if (!partner) {
            return null;
          }
          
          // Get active users list to check online status
          const activeUsers = getActiveUsers();
          const isOnline = activeUsers.some(user => 
            user.id === partnerId || user.userId === partnerId
          );
          
          return {
            id: partner.id,
            name: partner.nickname,
            isOnline: isOnline,
            lastMessage: null // We don't store messages on server
          };
        } catch (error) {
          console.error(`Error fetching details for chat partner ${partnerId}:`, error);
          return null;
        }
      })
    );
    
    // Filter out null entries
    const validSessions = sessionDetails.filter(session => session !== null);
    
    console.log(`Returning ${validSessions.length} valid chat sessions for user: ${currentUserId}`);
    res.json(validSessions);
    
  } catch (err) {
    console.error(`Error fetching active chat sessions for user ${currentUserId}:`, err);
    res.status(500).json({ error: 'Error retrieving active chat sessions' });
  }
});

/**
 * @swagger
 * /peregrinapp/users/init-chat:
 *   post:
 *     summary: Initialize a chat with a user
 *     description: Checks if a user can receive messages and initializes a chat session
 *     tags: [Users, Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: integer
 *                 description: The target user's ID
 *     responses:
 *       200:
 *         description: Chat initialization status
 *       400:
 *         description: Invalid user ID or user cannot receive messages
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Server error
 */
router.post('/init-chat', authenticateJWT, async (req, res) => {
  const currentUserId = req.user.userId;
  const { userId: targetUserId } = req.body;
  
  console.log(`Initializing chat between user ${currentUserId} and target ${targetUserId}`);
  
  if (!targetUserId) {
    return res.status(400).json({ error: 'Target user ID is required' });
  }
  
  try {
    // Parse and validate the target user ID
    const parsedTargetId = parseInt(targetUserId, 10);
    if (isNaN(parsedTargetId)) {
      return res.status(400).json({ error: 'Invalid target user ID format' });
    }
    
    // Check if initiating chat with self
    if (parsedTargetId === currentUserId) {
      return res.status(400).json({ error: 'Cannot initiate chat with yourself' });
    }
    
    // Check if target user can receive messages
    const canReceive = await chatService.canReceiveMessages(parsedTargetId);
    if (!canReceive.allowed) {
      console.log(`Target user ${parsedTargetId} cannot receive messages: ${canReceive.reason}`);
      return res.status(400).json({ 
        error: canReceive.reason === 'dms_disabled' 
          ? 'User has disabled direct messages' 
          : 'Cannot initiate chat with this user',
        reason: canReceive.reason
      });
    }
    
    // Get target user details
    const targetUser = await getUserById(parsedTargetId);
    if (!targetUser) {
      return res.status(404).json({ error: 'Target user not found' });
    }
    
    // Get active users to check online status
    const activeUsers = getActiveUsers();
    const isOnline = activeUsers.some(user => 
      user.id === parsedTargetId || user.userId === parsedTargetId
    );
    
    // Return success with target user info
    res.json({
      success: true,
      user: {
        id: targetUser.id,
        name: targetUser.nickname,
        isOnline: isOnline
      }
    });
    
  } catch (err) {
    console.error(`Error initializing chat for user ${currentUserId} with target ${targetUserId}:`, err);
    res.status(500).json({ error: 'Error initializing chat' });
  }
});

module.exports = router; 