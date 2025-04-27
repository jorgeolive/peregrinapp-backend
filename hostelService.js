const { Pool } = require('pg');
const pool = new Pool();

async function getHostelById(id) {
  const result = await pool.query(
    `SELECT id, name, description, address, phone, email, capacity, price
     FROM peregrinapp.hostels
     WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}

module.exports = { getHostelById };