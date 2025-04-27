require('dotenv').config();
const express = require('express');
const { getHostelById } = require('./hostelService');
const { getStageById } = require('./stageService');

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the 'public' directory under the '/peregrinapp' path
app.use('/peregrinapp', express.static('public'));

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

// Endpoint to get stage by id
app.get('/peregrinapp/stages/:id', async (req, res) => {
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});