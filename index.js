require('dotenv').config();
const express = require('express');
const { getHostelById } = require('./hostelService');
const { getStageById } = require('./stageService');
const { 
  addUser, 
  getUserByPhoneNumber, 
  verifyUserPassword, 
  activateUser,
  resendActivationCode
} = require('./userService');
const { generateToken, authenticateJWT, requireActivated } = require('./authService');

const app = express();
const port = process.env.PORT || 3000;

// Middleware for parsing JSON bodies
app.use(express.json());

// Serve static files from the 'public' directory under the '/peregrinapp' path
app.use('/peregrinapp', express.static('public'));

app.get('/peregrinapp/hostels/:id', async (req, res) => {
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

// Endpoint to get stage by id
app.get('/peregrinapp/stages/:id', async (req, res) => {
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

app.get('/peregrinapp/users/:phoneNumber', async (req, res) => {
  const { phoneNumber } = req.params;
  try {
    const user = await getUserByPhoneNumber(phoneNumber);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Don't send the password hash back to the client
    delete user.password_hash;
    
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

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
    delete user.password_hash;
    
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

// Endpoint to activate user with verification code
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

// Endpoint to resend activation code
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
    
    delete user.password_hash;
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});