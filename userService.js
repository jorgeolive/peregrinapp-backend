const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const pool = new Pool();

const SALT_ROUNDS = 10;

async function addUser(phoneNumber, nickname, dateOfBirth, bio, isActivated, password, enableDms = false) {
  console.log(`Adding new user with phone number: ${phoneNumber}, nickname: ${nickname}`);
  try {
    const passwordHash = password ? await bcrypt.hash(password, SALT_ROUNDS) : null;
    console.log('Password hashed successfully');
    
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
    
    console.log(`User created successfully with ID: ${result.rows[0].id}`);
    
    if (!isActivated) {
      await generateActivationCode(result.rows[0].id);
      console.log(`Activation code generated for user ID: ${result.rows[0].id}`);
    }
    
    const user = result.rows[0];
    
    const formattedUser = {
      id: user.id,
      phoneNumber: user.phone_number,
      nickname: user.nickname,
      dateOfBirth: user.date_of_birth,
      bio: user.bio,
      isActivated: user.is_activated,
      enableDms: user.enable_dms,
      createdAt: user.created_at
    };
    
    console.log('User addition completed successfully');
    return formattedUser;
  } catch (error) {
    console.error('Error adding user:', error.message);
    throw error;
  }
}

async function getUserById(userId) {
  console.log(`Getting user data for ID: ${userId}`);
  try {
    const result = await pool.query(
      `SELECT id, phone_number, nickname, date_of_birth, bio, is_activated, 
              password_hash, enable_dms, created_at
       FROM peregrinapp.users
       WHERE id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      console.log(`No user found with ID: ${userId}`);
      return null;
    }
    
    const user = result.rows[0];
    console.log(`Found user with ID: ${userId}, phone: ${user.phone_number}`);
    
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
  } catch (error) {
    console.error(`Error retrieving user with ID: ${userId}`, error);
    throw error;
  }
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
  
  return {
    id: user.id,
    phoneNumber: user.phone_number,
    nickname: user.nickname,
    dateOfBirth: user.date_of_birth,
    bio: user.bio,
    isActivated: user.is_activated,
    enableDms: user.enable_dms,
    createdAt: user.created_at,
    password_hash: user.password_hash
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

async function generateActivationCode(userId) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  
  const userResult = await pool.query(
    `SELECT phone_number FROM peregrinapp.users WHERE id = $1`,
    [userId]
  );
  
  if (userResult.rows.length === 0) {
    throw new Error(`User with ID ${userId} not found`);
  }
  
  const phoneNumber = userResult.rows[0].phone_number;
  
  console.log(`Generating activation code for user ID: ${userId}, phone: ${phoneNumber}`);
  
  await pool.query(
    `INSERT INTO peregrinapp.activation_codes 
     (phone_number, user_id, activation_code, created_at, expires_at)
     VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '1 hour')`,
    [phoneNumber, userId, code]
  );
  
  // In a real application, you would send this code via SMS
  console.log(`Activation code for user ${userId}: ${code}`);
  
  return code;
}

async function activateUser(phoneNumber, code) {
  console.log(`Attempting to activate user with phone ${phoneNumber} with code ${code}`);
  
  // Verify the activation code
  const codeResult = await pool.query(
    `SELECT activation_code, user_id
     FROM peregrinapp.activation_codes
     WHERE phone_number = $1 AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [phoneNumber]
  );
  
  if (codeResult.rows.length === 0) {
    console.log(`No valid activation code found for phone number ${phoneNumber}`);
    return { success: false, message: 'Invalid or expired activation code' };
  }
  
  if (codeResult.rows[0].activation_code !== code) {
    console.log(`Activation code mismatch for phone number ${phoneNumber}`);
    return { success: false, message: 'Invalid activation code' };
  }
  
  const userId = codeResult.rows[0].user_id;
  
  await pool.query(
    `UPDATE peregrinapp.users
     SET is_activated = TRUE
     WHERE phone_number = $1`,
    [phoneNumber]
  );
  
  console.log(`User with phone ${phoneNumber} activated successfully`);
  return { success: true, message: 'Account activated successfully' };
}

async function resendActivationCode(phoneNumber) {
  console.log(`Attempting to resend activation code for phone number ${phoneNumber}`);
  
  const user = await getUserByPhoneNumber(phoneNumber);
  
  if (!user) {
    console.log(`User with phone number ${phoneNumber} not found`);
    return { success: false, message: 'User not found' };
  }
  
  if (user.isActivated) {
    console.log(`User with phone number ${phoneNumber} is already activated`);
    return { success: false, message: 'User is already activated' };
  }
  
  const code = await generateActivationCode(user.id);
  console.log(`New activation code generated for phone number ${phoneNumber}`);
  
  return { success: true, message: 'Activation code sent' };
}

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