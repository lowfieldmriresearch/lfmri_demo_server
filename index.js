const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 5001;
const upload = multer({ dest: 'uploads/' });
const ss = require('simple-statistics');

// Enable CORS
app.use(cors({
  origin: 'https://lfmri-demo-client.onrender.com',
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());

// Simple root route to check server status
app.get('/', (req, res) => {
  console.log('Root route accessed');
  res.send('Hello from the server!');
});

// Load reference percentile data from JSON file
const loadPercentiles = (option) => {
  const fileName = (option === 'PT') ? 'growth_curves_pt.json' : 'growth_curves_ft.json';  
  const data = fs.readFileSync(path.join(__dirname, fileName));
  return JSON.parse(data);
};


// Process the CSV file and compute percentiles based on the reference data
app.post('/api/process-csv', upload.single('file'), (req, res) => {
  console.log("Received file upload.");

  const option = req.body.option; // 'PT' or 'FT'

  if (!req.file) {
    console.error("No file received!");
    return res.status(400).json({ error: "No file received" });
  }

  const results = [];

  // Read the uploaded CSV file
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', () => {
      fs.unlinkSync(req.file.path); // clean up temp file

      console.log("User uploaded CSV parsed:", results);

      const subject = results[0];  // Get the single subject data
      const subjectAge = parseFloat(subject.PMA);

      // Load reference percentiles from JSON file
      const referencePercentiles = loadPercentiles(option);

      const brainRegions = Object.keys(referencePercentiles); // Assuming keys are region names
      const percentiles = {};

      // Iterate over each brain region
      brainRegions.forEach(region => {
        // loop over regions, here regions is defined the .JSON file.
        // so always full 47 brain regions,
        const refData = referencePercentiles[region];
        const regionPercentiles = [];
        // Initialize the percentiles for each region
        const percentilesForRegion = {
          p5: [],
          p25: [],
          p50: [],
          p75: [],
          p95: [],
          inputrawv: [] ,
          inputPercentile: [] ,
          curPMA: []
        };
        
        

        const inputVolume = parseFloat(subject[region]);  // Assuming you have the input volume here
        console.log("Subject's Brain Region Volume:", inputVolume);

        
        const interpolatedPercentiles = {};
        Object.keys(refData.percentiles).forEach(p => {
          const ageIndex = refData.ages.findIndex(age => age >= subjectAge);
          if (ageIndex !== -1) {
            const percentile = interpolate(subjectAge, refData.ages, refData.percentiles[p]);
            interpolatedPercentiles[p] = percentile;
          } else {
            interpolatedPercentiles[p] = null; // No percentile available for this age
          }
        });

        const estimatedPercentile = estimatePercentile(inputVolume, interpolatedPercentiles.p5,interpolatedPercentiles.p25,interpolatedPercentiles.p50,interpolatedPercentiles.p75, interpolatedPercentiles.p95);

        

        // Store the interpolated percentiles and estimated percentile for the input volume

        percentilesForRegion.p5 = interpolatedPercentiles.p5;
        percentilesForRegion.p25 = interpolatedPercentiles.p25;
        percentilesForRegion.p50 = interpolatedPercentiles.p50;
        percentilesForRegion.p75 = interpolatedPercentiles.p75;
        percentilesForRegion.p95 = interpolatedPercentiles.p95;
        percentilesForRegion.inputrawv = inputVolume;
        percentilesForRegion.inputPercentile = estimatedPercentile;
        percentilesForRegion.curPMA = subjectAge;


         // Push the region's data to the main percentiles object
        regionPercentiles.push(percentilesForRegion);
        percentiles[region] = regionPercentiles;
      });
      //console.log(percentiles)

      //// **debugs checking windwows** ////
      //console.log(subjectAge)
      

      // Respond with the computed percentiles
      res.json({ percentiles });
    })
    .on('error', (err) => {
      console.error("CSV parsing error:", err);
      res.status(500).json({ error: "CSV parsing failed" });
    });
});



// Route to fetch percentiles for the selected brain region
app.get('/api/get-region-percentiles', (req, res) => {
  const region = req.query.region;  // Get the selected region from the query parameter
  const option = req.query.option; 
  const referencePercentiles = loadPercentiles(option); // Load the reference percentiles data

  // Check if the region exists in the reference data
  const regionData = referencePercentiles[region];

  if (!regionData) {
    return res.status(404).json({ error: "Region not found" });  // Return error if region doesn't exist
  }

  // Respond with the region data (percentiles and ages)
  res.json({
    ages: regionData.ages,
    p5: regionData.percentiles.p5,
    p25: regionData.percentiles.p25,
    p50: regionData.percentiles.p50,
    p75: regionData.percentiles.p75,
    p95: regionData.percentiles.p95
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});

// Start the server
const PORT = 5001;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

// Interpolation function (simple linear interpolation)
function interpolate(x, xValues, yValues) {
  if (x <= xValues[0]) return yValues[0];  // If x is smaller than the smallest xValue
  if (x >= xValues[xValues.length - 1]) return yValues[yValues.length - 1];  // If x is larger than the largest xValue

  let i = 0;
  while (xValues[i] < x) {
    i++;
  }

  const x0 = xValues[i - 1];
  const x1 = xValues[i];
  const y0 = yValues[i - 1];
  const y1 = yValues[i];

  // Simple linear interpolation formula
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

function interpolatePercentiles(subjectAge, refData) {
  const interpolatedPercentiles = {};

  // Interpolate each percentile for a given region
  ['p5', 'p25', 'p50', 'p75', 'p95'].forEach((p) => {
    interpolatedPercentiles[p] = interpolate(subjectAge, refData.ages, refData.percentiles[p]);
  });

  return interpolatedPercentiles;
}


// estimate percentile from the input brain region volumes.
// Standard normal CDF (approximation using error function)
// Standard normal CDF
function normCDF(z) {
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

// Error function approximation
function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  const a1 = 0.254829592,
        a2 = -0.284496736,
        a3 = 1.421413741,
        a4 = -1.453152027,
        a5 = 1.061405429,
        p = 0.3275911;

  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - (((((
    a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));

  return sign * y;
}

// Improved percentile estimator using 5-point fit
function estimatePercentile(inputVolume, p5, p25, p50, p75, p95) {

  // Use p50 as better estimate of mu
  const mu = p50;

  // Known z-scores for corresponding percentiles
  const zVals = [-1.6449, -0.6745, 0, 0.6745, 1.6449];
  const vols = [p5, p25, p50, p75, p95];

  // Fit sigma using least squares on (z, volume - mu)
  const deltas = vols.map(v => v - mu);
  const zTimesDelta = zVals.map((z, i) => z * deltas[i]);
  const zSquared = zVals.map(z => z * z);

  const sumZDelta = zTimesDelta.reduce((a, b) => a + b, 0);
  const sumZ2 = zSquared.reduce((a, b) => a + b, 0);

  const sigma = sumZDelta / sumZ2;

  // Compute z and map to percentile
  const z = (inputVolume - mu) / sigma;
  const percentile = normCDF(z) * 100;

  return percentile;
}



