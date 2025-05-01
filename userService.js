const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const pool = new Pool();

const SALT_ROUNDS = 10;

async function addUser(phoneNumber, nickname, dateOfBirth, bio, isActivated, password, sharePosition = false, enableDms = false) {
  // Hash the password
  const passwordHash = password ? await bcrypt.hash(password, SALT_ROUNDS) : null;
  
  const result = await pool.query(
    `INSERT INTO peregrinapp.users (
      phone_number, nickname, date_of_birth, bio, is_activated, 
      password_hash, share_position, enable_dms, created_at
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     RETURNING id, phone_number, nickname, date_of_birth, bio, is_activated, 
               share_position, enable_dms, created_at`,
    [phoneNumber, nickname, dateOfBirth, bio, isActivated, passwordHash, sharePosition, enableDms]
  );
  
  // Generate activation code if user is not already activated
  if (!isActivated) {
    await generateActivationCode(phoneNumber);
  }
  
  return result.rows[0];
}

async function getUserByPhoneNumber(phoneNumber) {
  const result = await pool.query(
    `SELECT id, phone_number, nickname, date_of_birth, bio, is_activated, 
            password_hash, share_position, enable_dms, created_at
     FROM peregrinapp.users
     WHERE phone_number = $1`,
    [phoneNumber]
  );
  return result.rows[0];
}

async function verifyUserPassword(phoneNumber, password) {
  const user = await getUserByPhoneNumber(phoneNumber);
  if (!user || !user.password_hash) return false;
  
  return bcrypt.compare(password, user.password_hash);
}

// Generate a random 6-digit activation code
function generateRandomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Store activation code for a user
async function generateActivationCode(phoneNumber) {
  const activationCode = generateRandomCode();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 1); // Code expires in 1 hour
  
  // Delete any existing activation codes for the user
  await pool.query(
    `DELETE FROM peregrinapp.activation_codes 
     WHERE phone_number = $1`,
    [phoneNumber]
  );
  
  // Insert new activation code
  await pool.query(
    `INSERT INTO peregrinapp.activation_codes (phone_number, activation_code, expires_at)
     VALUES ($1, $2, $3)`,
    [phoneNumber, activationCode, expiresAt]
  );
  
  // Here would be the place to call an SMS service to send the code
  console.log(`Activation code for ${phoneNumber}: ${activationCode}`);
  
  return activationCode;
}

// Verify and activate a user with their activation code
async function activateUser(phoneNumber, activationCode) {
  // Get the stored activation code
  const result = await pool.query(
    `SELECT activation_code, expires_at 
     FROM peregrinapp.activation_codes 
     WHERE phone_number = $1`,
    [phoneNumber]
  );
  
  const storedCode = result.rows[0];
  
  // Check if code exists, matches, and hasn't expired
  if (!storedCode) {
    return { success: false, message: 'No activation code found' };
  }
  
  if (storedCode.activation_code !== activationCode) {
    return { success: false, message: 'Invalid activation code' };
  }
  
  if (new Date() > storedCode.expires_at) {
    return { success: false, message: 'Activation code has expired' };
  }
  
  // Activate the user
  await pool.query(
    `UPDATE peregrinapp.users 
     SET is_activated = true 
     WHERE phone_number = $1`,
    [phoneNumber]
  );
  
  // Delete the used activation code
  await pool.query(
    `DELETE FROM peregrinapp.activation_codes 
     WHERE phone_number = $1`,
    [phoneNumber]
  );
  
  return { success: true, message: 'User activated successfully' };
}

// Generate a new activation code and "send" it again
async function resendActivationCode(phoneNumber) {
  const user = await getUserByPhoneNumber(phoneNumber);
  
  if (!user) {
    return { success: false, message: 'User not found' };
  }
  
  if (user.is_activated) {
    return { success: false, message: 'User is already activated' };
  }
  
  await generateActivationCode(phoneNumber);
  
  return { success: true, message: 'Activation code sent' };
}

// Update user preferences
async function updateUserPreferences(phoneNumber, sharePosition, enableDms) {
  const result = await pool.query(
    `UPDATE peregrinapp.users
     SET share_position = $2, enable_dms = $3
     WHERE phone_number = $1
     RETURNING id, phone_number, nickname, date_of_birth, bio, is_activated, 
               share_position, enable_dms, created_at`,
    [phoneNumber, sharePosition, enableDms]
  );
  return result.rows[0];
}

module.exports = { 
  addUser, 
  getUserByPhoneNumber, 
  verifyUserPassword,
  activateUser,
  resendActivationCode,
  updateUserPreferences
}; 