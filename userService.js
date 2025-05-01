const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const pool = new Pool();

const SALT_ROUNDS = 10;

async function addUser(phoneNumber, nickname, dateOfBirth, bio, isActivated, password) {
  // Hash the password
  const passwordHash = password ? await bcrypt.hash(password, SALT_ROUNDS) : null;
  
  const result = await pool.query(
    `INSERT INTO peregrinapp.users (phone_number, nickname, date_of_birth, bio, is_activated, password_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id, phone_number, nickname, date_of_birth, bio, is_activated, created_at`,
    [phoneNumber, nickname, dateOfBirth, bio, isActivated, passwordHash]
  );
  return result.rows[0];
}

async function getUserByPhoneNumber(phoneNumber) {
  const result = await pool.query(
    `SELECT id, phone_number, nickname, date_of_birth, bio, is_activated, password_hash, created_at
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

module.exports = { addUser, getUserByPhoneNumber, verifyUserPassword }; 