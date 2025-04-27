const { Pool } = require('pg');
const pool = new Pool();

async function getStageById(id) {
  const result = await pool.query(
    `SELECT s.id, s.length, s.description, 
            ARRAY_AGG(si.image_url) as images
     FROM peregrinapp.stages s
     LEFT JOIN peregrinapp.stageimages si ON s.id = si.stage_id
     WHERE s.id = $1
     GROUP BY s.id, s.length, s.description`,
    [id]
  );
  return result.rows[0];
}

module.exports = { getStageById };