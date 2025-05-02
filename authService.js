const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_change_in_production';
const TOKEN_EXPIRY = '100d';

function generateToken(user) {
  const payload = {
    phone: user.phoneNumber,
    nickname: user.nickname,
    isActivated: user.isActivated,
    sharePosition: user.sharePosition,
    enableDms: user.enableDms
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// Verify and decode a JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required' });
  }
  
  const token = authHeader.split(' ')[1];
  
  const decodedToken = verifyToken(token);
  if (!decodedToken) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
  
  req.user = decodedToken;
  
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