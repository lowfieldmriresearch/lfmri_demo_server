const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 5001;
const upload = multer({ dest: 'uploads/' });

// CORS configuration
app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());

// Simple root route to check server status
app.get('/', (req, res) => {
  console.log('Root route accessed');
  res.send('Hello from the server!');
});

// Your existing /api/process-csv route
app.post('/api/process-csv', upload.single('file'), (req, res) => {
  console.log("Received file upload.");

  if (!req.file) {
      console.error("No file received!");
      return res.status(400).json({ error: "No file received" });
  }

  const results = [];

  fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => {
          fs.unlinkSync(req.file.path); // clean up temp file

          console.log("CSV parsed:", results);

          const brainRegions = Object.keys(results[0]).filter(k => k !== 'SubjectID' && k !== 'AgeDays');
          const percentiles = {};

          brainRegions.forEach(region => {
              percentiles[region] = Array.from({ length: 11 }, (_, i) => Math.random() * 100); // dummy
          });

          res.json({ percentiles });
      })
      .on('error', (err) => {
          console.error("CSV parsing error:", err);
          res.status(500).json({ error: "CSV parsing failed" });
      });
});

// Start the server
app.listen(port, () => {
    console.log(`Backend running on http://localhost:${port}`);
});
