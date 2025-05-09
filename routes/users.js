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
 * /peregrinapp/users/{phoneNumber}:
 *   get:
 *     summary: Get user by phone number
 *     description: Retrieves user details by phone number (requires authentication)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: phoneNumber
 *         required: true
 *         schema:
 *           type: string
 *         description: The user's phone number
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
router.get('/:phoneNumber', authenticateJWT, async (req, res) => {
  const { phoneNumber } = req.params;
  try {
    const user = await getUserByPhoneNumber(phoneNumber);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
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
  const { userId, activationCode } = req.body;
  
  if (!userId || !activationCode) {
    return res.status(400).json({ error: 'User ID and activation code are required' });
  }
  
  try {
    const result = await activateUser(userId, activationCode);
    
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
  const phoneNumber = req.user.phone;
  
  // Make sure at least one property is provided
  if (enableDms === undefined && bio === undefined) {
    return res.status(400).json({ error: 'At least one property must be provided' });
  }
  
  try {
    // Get current user to access current values
    const currentUser = await getUserByPhoneNumber(phoneNumber);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Use provided values or fall back to current values
    const updatedEnableDms = enableDms !== undefined ? enableDms : currentUser.enableDms;
    const updatedBio = bio !== undefined ? bio : currentUser.bio;
    
    // Update the user profile
    const updatedUser = await updateUserPreferences(
      phoneNumber, 
      updatedEnableDms,
      updatedBio
    );
    
    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (err) {
    console.error(err);
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
  
  if (!phoneNumber || !password) {
    return res.status(400).json({ error: 'Phone number and password are required' });
  }
  
  try {
    const passwordCheck = await verifyUserPassword(phoneNumber, password);
    if (!passwordCheck.valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = await getUserById(passwordCheck.userId);
    
    // Generate JWT token
    const token = generateToken(user);
    
    res.json({ 
      message: 'Login successful',
      user,
      token
    });
  } catch (err) {
    console.error(err);
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

module.exports = router; 