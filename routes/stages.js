const express = require('express');
const router = express.Router();
const { getStageById } = require('../stageService');
const { authenticateJWT } = require('../authService');

/**
 * @swagger
 * /peregrinapp/stages/{id}:
 *   get:
 *     summary: Get stage by ID
 *     description: Retrieves details for a specific stage (requires authentication)
 *     tags: [Stages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The stage ID
 *     responses:
 *       200:
 *         description: Stage details
 *       401:
 *         description: Unauthorized - authentication required
 *       404:
 *         description: Stage not found
 *       500:
 *         description: Server error
 */
router.get('/:id', authenticateJWT, async (req, res) => {
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

module.exports = router; 