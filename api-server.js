const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
const DATA_FILE = '/opt/nexus/data/trades.json';
const DATA_DIR = '/opt/nexus/data';

// Middleware
app.use(cors());
app.use(bodyParser.json({limit: '50mb'}));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize data file if doesn't exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
        trades: [],
        patterns: [],
        performance: {}
    }));
}

// GET - Retrieve all data
app.get('/api/data', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read data' });
    }
});

// POST - Save data (full replace)
app.post('/api/data', (req, res) => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
        res.json({ success: true, message: 'Data saved' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save data' });
    }
});

// POST - Append single trade
app.post('/api/trade', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (!data.trades) data.trades = [];
        data.trades.push(req.body);
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        res.json({ success: true, message: 'Trade added' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add trade' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Nexus API running on port ${PORT}`);
    console.log(`📊 Data file: ${DATA_FILE}`);
});
