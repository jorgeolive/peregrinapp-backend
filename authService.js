const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_change_in_production';
const TOKEN_EXPIRY = '100d';

function generateToken(user) {
  const payload = {
    phone: user.phoneNumber
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/**
 * Verify JWT token validity
 * 
 * @param {string} token - The JWT token to verify
 * @returns {Object} Object containing validity status and decoded token or error
 */
const verifyToken = (token) => {
  if (!token) {
    return { 
      valid: false, 
      error: 'Token is required'
    };
  }

  try {
    // Remove 'Bearer ' prefix if present
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    
    // Verify JWT token
    const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET || 'your_jwt_secret');
    
    // Check if token payload has minimum required fields
    if (!decoded || !decoded.phone) {
      return {
        valid: false,
        error: 'Invalid token payload'
      };
    }
    
    return {
      valid: true,
      decoded
    };
  } catch (error) {
    let errorMessage = 'Invalid token';
    
    if (error.name === 'TokenExpiredError') {
      errorMessage = 'Token has expired';
    } else if (error.name === 'JsonWebTokenError') {
      errorMessage = 'Invalid token format';
    }
    
    return {
      valid: false,
      error: errorMessage,
      originalError: error
    };
  }
};

function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required' });
  }
  
  const token = authHeader.split(' ')[1];
  
  const tokenResult = verifyToken(token);
  if (!tokenResult.valid) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
  
  // Set minimal user data from token
  req.user = tokenResult.decoded;
  
  next();
}

// Check if user is activated middleware
async function requireActivated(req, res, next) {
  try {
    // Get the user from the database since token only has phone number
    const { getUserByPhoneNumber } = require('./userService');
    const user = await getUserByPhoneNumber(req.user.phone);
    
    if (!user || !user.isActivated) {
      return res.status(403).json({ error: 'Account not activated' });
    }
    
    next();
  } catch (error) {
    console.error('Error checking user activation:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  generateToken,
  verifyToken,
  authenticateJWT,
  requireActivated
}; 