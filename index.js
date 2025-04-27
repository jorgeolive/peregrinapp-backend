require('dotenv').config();
const express = require('express');
const { getHostelById } = require('./hostelService');

const app = express();
const port = process.env.PORT || 3000;

app.get('/peregrinapp/hostels/:id', async (req, res) => {
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});