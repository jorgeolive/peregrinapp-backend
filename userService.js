const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const pool = new Pool();

const SALT_ROUNDS = 10;

async function addUser(phoneNumber, nickname, dateOfBirth, bio, isActivated, password, enableDms = false) {
  // Hash the password
  const passwordHash = password ? await bcrypt.hash(password, SALT_ROUNDS) : null;
  
  const result = await pool.query(
    `INSERT INTO peregrinapp.users (
      phone_number, nickname, date_of_birth, bio, is_activated, 
      password_hash, enable_dms, created_at
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING id, phone_number, nickname, date_of_birth, bio, is_activated, 
               enable_dms, created_at`,
    [phoneNumber, nickname, dateOfBirth, bio, isActivated, passwordHash, enableDms]
  );
  
  // Generate activation code if user is not already activated
  if (!isActivated) {
    await generateActivationCode(result.rows[0].id);
  }
  
  const user = result.rows[0];
  
  // Transform snake_case to camelCase 
  return {
    id: user.id,
    phoneNumber: user.phone_number,
    nickname: user.nickname,
    dateOfBirth: user.date_of_birth,
    bio: user.bio,
    isActivated: user.is_activated,
    enableDms: user.enable_dms,
    createdAt: user.created_at
  };
}

async function getUserById(userId) {
  const result = await pool.query(
    `SELECT id, phone_number, nickname, date_of_birth, bio, is_activated, 
            password_hash, enable_dms, created_at
     FROM peregrinapp.users
     WHERE id = $1`,
    [userId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const user = result.rows[0];
  
  // Transform snake_case to camelCase and remove password_hash
  return {
    id: user.id,
    phoneNumber: user.phone_number,
    nickname: user.nickname,
    dateOfBirth: user.date_of_birth,
    bio: user.bio,
    isActivated: user.is_activated,
    enableDms: user.enable_dms,
    createdAt: user.created_at,
    password_hash: user.password_hash // Keep this for internal use but it gets removed by most endpoints
  };
}

async function getUserByPhoneNumber(phoneNumber) {
  const result = await pool.query(
    `SELECT id, phone_number, nickname, date_of_birth, bio, is_activated, 
            password_hash, enable_dms, created_at
     FROM peregrinapp.users
     WHERE phone_number = $1`,
    [phoneNumber]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const user = result.rows[0];
  
  // Transform snake_case to camelCase and remove password_hash
  return {
    id: user.id,
    phoneNumber: user.phone_number,
    nickname: user.nickname,
    dateOfBirth: user.date_of_birth,
    bio: user.bio,
    isActivated: user.is_activated,
    enableDms: user.enable_dms,
    createdAt: user.created_at,
    password_hash: user.password_hash // Keep this for internal use but it gets removed by most endpoints
  };
}

async function verifyUserPassword(phoneNumber, password) {
  const result = await pool.query(
    `SELECT id, password_hash
     FROM peregrinapp.users
     WHERE phone_number = $1`,
    [phoneNumber]
  );
  
  const user = result.rows[0];
  if (!user || !user.password_hash) return { valid: false };
  
  const isValid = await bcrypt.compare(password, user.password_hash);
  return { valid: isValid, userId: user.id };
}

// Function to generate activation code
async function generateActivationCode(userId) {
  // Generate a random 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Store the code in the database
  await pool.query(
    `INSERT INTO peregrinapp.activation_codes (code, user_id, created_at, expires_at)
     VALUES ($1, $2, NOW(), NOW() + INTERVAL '1 hour')`,
    [code, userId]
  );
  
  // In a real application, you would send this code via SMS
  console.log(`Activation code for user ${userId}: ${code}`);
  
  return code;
}

// Activate user account with code
async function activateUser(userId, code) {
  // Verify the activation code
  const codeResult = await pool.query(
    `SELECT code 
     FROM peregrinapp.activation_codes
     WHERE user_id = $1 AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  
  if (codeResult.rows.length === 0 || codeResult.rows[0].code !== code) {
    return { success: false, message: 'Invalid or expired activation code' };
  }
  
  // Update user status to activated
  await pool.query(
    `UPDATE peregrinapp.users
     SET is_activated = TRUE
     WHERE id = $1`,
    [userId]
  );
  
  return { success: true, message: 'Account activated successfully' };
}

// Generate a new activation code and "send" it again
async function resendActivationCode(userId) {
  const user = await getUserById(userId);
  
  if (!user) {
    return { success: false, message: 'User not found' };
  }
  
  if (user.isActivated) {
    return { success: false, message: 'User is already activated' };
  }
  
  await generateActivationCode(userId);
  
  return { success: true, message: 'Activation code sent' };
}

// Update user preferences and profile information
async function updateUserPreferences(userId, enableDms, bio) {
  const result = await pool.query(
    `UPDATE peregrinapp.users
     SET enable_dms = $2, bio = $3
     WHERE id = $1
     RETURNING id, phone_number, nickname, date_of_birth, bio, is_activated, 
               enable_dms, created_at`,
    [userId, enableDms, bio]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const user = result.rows[0];
  
  // Transform snake_case to camelCase like in getUserById
  return {
    id: user.id,
    phoneNumber: user.phone_number,
    nickname: user.nickname,
    dateOfBirth: user.date_of_birth,
    bio: user.bio,
    isActivated: user.is_activated,
    enableDms: user.enable_dms,
    createdAt: user.created_at
  };
}

module.exports = { 
  addUser, 
  getUserById,
  getUserByPhoneNumber, 
  verifyUserPassword,
  activateUser,
  resendActivationCode,
  updateUserPreferences
}; 