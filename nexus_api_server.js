#!/usr/bin/env node
/**
 * NEXUS 4.0 - ENHANCED API SERVER
 * 
 * Enhanced API server that works with the autonomous exit engine.
 * Handles trade data storage, retrieval, and health checks.
 * 
 * Run with PM2: pm2 start nexus_api_server.js --name nexus-api-server
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3001;

// Configuration
const DATA_FILE = '/opt/nexus/data/trades.json';
const LOG_FILE = '/opt/nexus/logs/api_server.log';

// Middleware
app.use(cors());
app.use(express.json());

// Ensure data directory exists
async function ensureDataDir() {
    const dataDir = path.dirname(DATA_FILE);
    const logDir = path.dirname(LOG_FILE);
    
    try {
        await fs.mkdir(dataDir, { recursive: true });
        await fs.mkdir(logDir, { recursive: true });
    } catch (err) {
        console.error('Failed to create directories:', err.message);
    }
}

// Logging helper
function log(message, data = null) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const logEntry = `[${timestamp}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`;
    console.log(logEntry);
    
    // Async file logging (don't wait)
    fs.appendFile(LOG_FILE, logEntry + '\n', 'utf8').catch(() => {});
}

// Load trade data from file
async function loadTradeData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            // Return default structure if file doesn't exist
            return {
                trades: [],
                activeTrades: { btc: null, eth: null },
                performance: {
                    totalTrades: 0,
                    winners: 0,
                    losers: 0,
                    breakevenTrades: 0,
                    totalProfit: 0,
                    winRate: 0,
                    profitFactor: 0,
                    avgWin: 0,
                    avgLoss: 0,
                    breakevenRate: 0
                },
                timestamp: Date.now()
            };
        }
        throw err;
    }
}

// Save trade data to file
async function saveTradeData(data) {
    try {
        await ensureDataDir();
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        log('ERROR: Failed to save trade data', { error: err.message });
        return false;
    }
}

// ============================================
// API ROUTES
// ============================================

// GET /api/data - Retrieve all trade data
app.get('/api/data', async (req, res) => {
    try {
        const data = await loadTradeData();
        log('GET /api/data - Returning trade data', { 
            trades: data.trades?.length || 0,
            activeTrades: Object.keys(data.activeTrades || {}).filter(k => data.activeTrades[k]).length
        });
        res.json(data);
    } catch (err) {
        log('ERROR: GET /api/data failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load trade data' });
    }
});

// POST /api/data - Save trade data
app.post('/api/data', async (req, res) => {
    try {
        const data = req.body;
        
        // Validate data structure
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Invalid data structure' });
        }

        // Ensure required fields exist
        if (!data.trades) data.trades = [];
        if (!data.activeTrades) data.activeTrades = { btc: null, eth: null };
        if (!data.performance) {
            data.performance = {
                totalTrades: 0,
                winners: 0,
                losers: 0,
                breakevenTrades: 0,
                totalProfit: 0,
                winRate: 0,
                profitFactor: 0,
                avgWin: 0,
                avgLoss: 0,
                breakevenRate: 0
            };
        }

        data.timestamp = Date.now();

        const saved = await saveTradeData(data);
        
        if (saved) {
            log('POST /api/data - Trade data saved', {
                trades: data.trades?.length || 0,
                activeTrades: Object.keys(data.activeTrades || {}).filter(k => data.activeTrades[k]).length
            });
            res.json({ success: true, message: 'Data saved successfully', timestamp: data.timestamp });
        } else {
            res.status(500).json({ error: 'Failed to save data' });
        }
    } catch (err) {
        log('ERROR: POST /api/data failed', { error: err.message });
        res.status(500).json({ error: 'Failed to save trade data' });
    }
});

// GET /api/health - Health check endpoint
app.get('/api/health', (req, res) => {
    loadTradeData().then(data => {
        const activeTradeCount = Object.values(data.activeTrades || {})
            .filter(t => t !== null && t !== undefined).length;
        
        res.json({
            status: 'online',
            activeTrades: activeTradeCount,
            trades: data.trades?.length || 0,
            performance: data.performance || {},
            lastSync: new Date().toISOString(),
            uptime: process.uptime(),
            timestamp: Date.now()
        });
    }).catch(err => {
        res.status(500).json({
            status: 'error',
            error: err.message,
            timestamp: Date.now()
        });
    });
});

// GET /api/stats - Performance statistics
app.get('/api/stats', async (req, res) => {
    try {
        const data = await loadTradeData();
        res.json({
            performance: data.performance || {},
            recentTrades: data.trades?.slice(-10) || [],
            activeTrades: data.activeTrades || {},
            timestamp: Date.now()
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load stats' });
    }
});

// POST /api/trades/close - Manually close a trade (for admin/testing)
app.post('/api/trades/close', async (req, res) => {
    try {
        const { asset, outcome, profit, exitPrice } = req.body;
        
        if (!asset || !outcome || !exitPrice) {
            return res.status(400).json({ error: 'Missing required fields: asset, outcome, exitPrice' });
        }

        const data = await loadTradeData();
        const trade = data.activeTrades?.[asset.toLowerCase()];
        
        if (!trade || !trade.setup) {
            return res.status(404).json({ error: 'No active trade found for ' + asset });
        }

        // Record outcome (simplified version)
        const calculatedProfit = profit !== undefined ? profit : 0;
        
        // Find existing trade record or create new one
        let tradeRecord = data.trades.find(t => 
            t.asset === asset.toLowerCase() && 
            t.setup?.timestamp === trade.setup.timestamp &&
            !t.outcome
        );

        if (tradeRecord) {
            tradeRecord.outcome = outcome;
            tradeRecord.profit = calculatedProfit;
            tradeRecord.exitPrice = exitPrice;
            tradeRecord.exitTime = Date.now();
            tradeRecord.closedBy = 'MANUAL_API';
        } else {
            data.trades.push({
                asset: asset.toLowerCase(),
                timestamp: trade.setup.timestamp,
                setup: trade.setup,
                outcome,
                profit: calculatedProfit,
                exitPrice,
                exitTime: Date.now(),
                closedBy: 'MANUAL_API'
            });
        }

        // Clear active trade
        data.activeTrades[asset.toLowerCase()] = null;

        // Update performance (simplified)
        data.performance.totalTrades = data.trades.length;
        if (outcome === 'WIN') data.performance.winners++;
        else if (outcome === 'LOSS') data.performance.losers++;
        else if (outcome === 'BREAKEVEN') data.performance.breakevenTrades++;

        await saveTradeData(data);
        
        log('POST /api/trades/close - Trade closed manually', { asset, outcome, profit: calculatedProfit });
        res.json({ success: true, message: 'Trade closed successfully' });
    } catch (err) {
        log('ERROR: POST /api/trades/close failed', { error: err.message });
        res.status(500).json({ error: 'Failed to close trade' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    log('ERROR: Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function startServer() {
    await ensureDataDir();
    
    app.listen(PORT, '0.0.0.0', () => {
        log(`✅ Nexus API Server started on port ${PORT}`);
        log(`📁 Data file: ${DATA_FILE}`);
        log(`📝 Log file: ${LOG_FILE}`);
    });
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    log('SIGTERM received - shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    log('SIGINT received - shutting down gracefully');
    process.exit(0);
});

// Start the server
startServer().catch(err => {
    console.error('Fatal error starting server:', err);
    process.exit(1);
});

module.exports = app;

