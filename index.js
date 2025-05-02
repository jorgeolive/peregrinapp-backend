require('dotenv').config();
const express = require('express');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { getHostelById } = require('./hostelService');
const { getStageById } = require('./stageService');
const { 
  addUser, 
  getUserByPhoneNumber, 
  verifyUserPassword, 
  activateUser,
  resendActivationCode,
  updateUserPreferences
} = require('./userService');
const { generateToken, authenticateJWT, requireActivated } = require('./authService');

const app = express();
const port = process.env.PORT || 3000;

// Swagger definition
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Peregrin App API',
      version: '1.0.0',
      description: 'API documentation for Peregrin App backend services',
    },
    servers: [
      {
        url: `http://localhost:${port}`,
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: ['./*.js'], // Path to the API docs
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

app.use(express.json());

// Serve static files from the 'public' directory under the '/peregrinapp' path
app.use('/peregrinapp', express.static('public'));

/**
 * @swagger
 * /peregrinapp/hostels/{id}:
 *   get:
 *     summary: Get hostel by ID
 *     description: Retrieves details for a specific hostel (requires authentication)
 *     tags: [Hostels]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The hostel ID
 *     responses:
 *       200:
 *         description: Hostel details
 *       401:
 *         description: Unauthorized - authentication required
 *       404:
 *         description: Hostel not found
 *       500:
 *         description: Server error
 */
app.get('/peregrinapp/hostels/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  try {
    const hostel = await getHostelById(id);
    if (!hostel) {
      return res.status(404).json({ error: 'Hostel not found' });
    }
    res.json(hostel);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

/**
 * @swagger
 * /peregrinapp/stages/{id}:
 *   get:
 *     summary: Get stage by ID
 *     description: Retrieves details for a specific stage (requires authentication)
 *     tags: [Stages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The stage ID
 *     responses:
 *       200:
 *         description: Stage details
 *       401:
 *         description: Unauthorized - authentication required
 *       404:
 *         description: Stage not found
 *       500:
 *         description: Server error
 */
app.get('/peregrinapp/stages/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  try {
    const stage = await getStageById(id);
    if (!stage) {
      return res.status(404).json({ error: 'Stage not found' });
    }
    res.json(stage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

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
app.post('/peregrinapp/users', async (req, res) => {
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
app.get('/peregrinapp/users/:phoneNumber', authenticateJWT, async (req, res) => {
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
 * /peregrinapp/login:
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Login successful
 *                 user:
 *                   type: object
 *                   properties:
 *                     phoneNumber:
 *                       type: string
 *                       description: User's phone number (primary identifier)
 *                     nickname:
 *                       type: string
 *                     dateOfBirth:
 *                       type: string
 *                       format: date
 *                     isActivated:
 *                       type: boolean
 *                     sharePosition:
 *                       type: boolean
 *                     enableDms:
 *                       type: boolean
 *                 token:
 *                   type: string
 *                   description: JWT token for authentication
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Server error
 */
app.post('/peregrinapp/login', async (req, res) => {
  const { phoneNumber, password } = req.body;
  
  if (!phoneNumber || !password) {
    return res.status(400).json({ error: 'Phone number and password are required' });
  }
  
  try {
    const isValid = await verifyUserPassword(phoneNumber, password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = await getUserByPhoneNumber(phoneNumber);
    
    // Generate JWT token
    const token = generateToken(user);
    console.log(user);
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
 *               - phoneNumber
 *               - activationCode
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: The user's phone number
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
app.post('/peregrinapp/users/activate', async (req, res) => {
  const { phoneNumber, activationCode } = req.body;
  
  if (!phoneNumber || !activationCode) {
    return res.status(400).json({ error: 'Phone number and activation code are required' });
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
 *               - phoneNumber
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: The user's phone number
 *     responses:
 *       200:
 *         description: Activation code sent successfully
 *       400:
 *         description: User not found or already activated
 *       500:
 *         description: Server error
 */
app.post('/peregrinapp/users/resend-code', async (req, res) => {
  const { phoneNumber } = req.body;
  
  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number is required' });
  }
  
  try {
    const result = await resendActivationCode(phoneNumber);
    
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

// Example of a protected route (requires authentication)
app.get('/peregrinapp/profile', authenticateJWT, async (req, res) => {
  try {
    // req.user contains the decoded JWT payload added by the middleware
    const user = await getUserByPhoneNumber(req.user.phone);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Example of a route that requires both authentication and activated account
app.get('/peregrinapp/protected-resource', authenticateJWT, requireActivated, (req, res) => {
  res.json({ 
    message: 'You have access to this protected resource',
    user: req.user
  });
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
 *               sharePosition:
 *                 type: boolean
 *                 description: Whether to share the user's position
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
app.put('/peregrinapp/users/profile', authenticateJWT, async (req, res) => {
  const { sharePosition, enableDms, bio } = req.body;
  const phoneNumber = req.user.phone;
  
  // Make sure at least one property is provided
  if (sharePosition === undefined && enableDms === undefined && bio === undefined) {
    return res.status(400).json({ error: 'At least one property must be provided' });
  }
  
  try {
    // Get current user to access current values
    const currentUser = await getUserByPhoneNumber(phoneNumber);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Use provided values or fall back to current values
    const updatedSharePosition = sharePosition !== undefined ? sharePosition : currentUser.sharePosition;
    const updatedEnableDms = enableDms !== undefined ? enableDms : currentUser.enableDms;
    const updatedBio = bio !== undefined ? bio : currentUser.bio;
    
    // Update the user profile
    const updatedUser = await updateUserPreferences(
      phoneNumber, 
      updatedSharePosition,
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});