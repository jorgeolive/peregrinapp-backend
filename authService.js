const jwt = require('jsonwebtoken');

// Use environment variable for JWT secret or a default one for development
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_change_in_production';
const TOKEN_EXPIRY = '7d'; // Token valid for 7 days

// Generate a JWT token for a user
function generateToken(user) {
  // Create a payload with user data (excluding sensitive info)
  const payload = {
    id: user.id,
    phone: user.phone_number,
    nickname: user.nickname,
    isActivated: user.is_activated
  };

  // Sign the token with our secret and set expiry
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// Verify and decode a JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null; // Return null if token is invalid
  }
}

// Authentication middleware for Expressz
function authenticateJWT(req, res, next) {
  // Get the authorization header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required' });
  }
  
  // Extract the token (remove "Bearer " prefix)
  const token = authHeader.split(' ')[1];
  
  // Verify the token
  const decodedToken = verifyToken(token);
  if (!decodedToken) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
  
  // Add the user data to the request object
  req.user = decodedToken;
  
  // Continue to the protected route
  next();
}

// Check if user is activated middleware
function requireActivated(req, res, next) {
  if (!req.user || !req.user.isActivated) {
    return res.status(403).json({ error: 'Account not activated' });
  }
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  authenticateJWT,
  requireActivated
}; 