const express = require('express');
const router = express.Router();
const { getHostelById } = require('../hostelService');
const { authenticateJWT } = require('../authService');

/**
 * @swagger
 * /peregrinapp/hostels/{id}:
 *   get:
 *     summary: Get hostel by ID
 *     description: Retrieves details for a specific hostel (requires authentication)
 *     tags: [Hostels]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The hostel ID
 *     responses:
 *       200:
 *         description: Hostel details
 *       401:
 *         description: Unauthorized - authentication required
 *       404:
 *         description: Hostel not found
 *       500:
 *         description: Server error
 */
router.get('/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  try {
    const hostel = await getHostelById(id);
    if (!hostel) {
      return res.status(404).json({ error: 'Hostel not found' });
    }
    res.json(hostel);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router; 