#!/usr/bin/env node
/**
 * NEXUS 4.0 - COMPLETE VPS TRADING ENGINE
 * 
 * ALL trading logic migrated from browser to VPS.
 * Runs 24/7 independently.
 * 
 * Run: pm2 start nexus_trading_engine_complete.js --name nexus-trading
 */

const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');
const express = require('express');

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    API_PORT: 3001,
    API_BASE: 'http://localhost:3001',
    SCAN_INTERVAL_MS: 3000,
    DATA_FILE: '/opt/nexus/data/trades.json',
    LOG_FILE: '/opt/nexus/logs/trading_engine.log',
    RISK_PER_TRADE: 10,
    MIN_BTC_POSITION: 0.0001,
    MIN_ETH_POSITION: 0.001
};

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker';
const RISK_CONFIGS = {
    conservative: { stopPct: 0.005, target1: 1.5, target2: 2.5, minConfidence: 8 },
    aggressive: { stopPct: 0.003, target1: 1.0, target2: 2.0, minConfidence: 6 }
};

// ============================================
// GLOBAL STATE
// ============================================
let riskMode = 'conservative';
let marketCondition = 'RANGING';
let volatilityLevel = 'NORMAL';
let priceHistory = { btc: [], eth: [] };
let currentPrices = { btc: 0, eth: 0 };
let lastSignalTime = { btc: 0, eth: 0 };
let activeTrades = { btc: null, eth: null };

const tradeDatabase = {
    trades: [],
    activeTrades: { btc: null, eth: null },
    performance: {
        totalTrades: 0, winners: 0, losers: 0, breakevenTrades: 0,
        totalProfit: 0, winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, breakevenRate: 0
    },
    patterns: {}
};

// ============================================
// LOGGING
// ============================================
async function log(level, message, data = null) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const logEntry = `[${timestamp}] [${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`;
    console.log(logEntry);
    try {
        await fs.appendFile(CONFIG.LOG_FILE, logEntry + '\n', 'utf8');
    } catch (err) {}
}

function logInfo(msg, data) { return log('INFO', msg, data); }
function logWarn(msg, data) { return log('WARN', msg, data); }
function logError(msg, data) { return log('ERROR', msg, data); }
function logSuccess(msg, data) { return log('SUCCESS', msg, data); }

// ============================================
// PRICE MONITORING
// ============================================
let ws = null;
let reconnectAttempts = 0;

function connectBinance() {
    try {
        ws = new WebSocket(BINANCE_WS_URL);
        ws.on('open', () => {
            logSuccess('Binance WebSocket connected');
            reconnectAttempts = 0;
        });
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.data) {
                    const symbol = msg.data.s.toLowerCase();
                    const price = parseFloat(msg.data.c);
                    const change = parseFloat(msg.data.P || 0);
                    
                    if (symbol.includes('btcusdt')) {
                        updatePrice('btc', price, change);
                    } else if (symbol.includes('ethusdt')) {
                        updatePrice('eth', price, change);
                    }
                }
            } catch (err) {
                logError('WebSocket parse error', { error: err.message });
            }
        });
        ws.on('error', (err) => {
            logError('WebSocket error', { error: err.message });
            setTimeout(connectBinance, 5000);
        });
        ws.on('close', () => {
            logWarn('WebSocket closed - reconnecting');
            reconnectAttempts++;
            if (reconnectAttempts < 10) {
                setTimeout(connectBinance, 5000);
            }
        });
    } catch (err) {
        logError('WebSocket connection failed', { error: err.message });
        setTimeout(connectBinance, 5000);
    }
}

function updatePrice(asset, price, change = 0) {
    if (!price || price <= 0) return;
    currentPrices[asset] = price;
    if (!priceHistory[asset]) priceHistory[asset] = [];
    priceHistory[asset].push({ price, change, time: Date.now() });
    if (priceHistory[asset].length > 50) priceHistory[asset].shift();
}

// ============================================
// MARKET ANALYSIS
// ============================================
function detectMarketCondition() {
    ['btc', 'eth'].forEach(asset => {
        if (priceHistory[asset] && priceHistory[asset].length >= 5) {
            const recent = priceHistory[asset].slice(-5);
            const trend = recent[recent.length - 1].price - recent[0].price;
            const avgChange = recent.reduce((sum, p) => sum + Math.abs(p.change || 0), 0) / recent.length;
            
            if (trend > currentPrices[asset] * 0.02) marketCondition = 'TRENDING_UP';
            else if (trend < -currentPrices[asset] * 0.02) marketCondition = 'TRENDING_DOWN';
            else marketCondition = 'RANGING';
            
            if (avgChange > 2.0) volatilityLevel = 'EXTREME';
            else if (avgChange > 1.5) volatilityLevel = 'HIGH';
            else if (avgChange > 0.8) volatilityLevel = 'NORMAL';
            else volatilityLevel = 'LOW';
        }
    });
}

// ============================================
// TRADE RECORDING (WITH FIXES)
// ============================================
async function recordTradeOutcome(asset, setup, outcome, profit) {
    // ✅ FIX #1: Only record completed trades
    if (!outcome || outcome === 'ACTIVE' || outcome === 'OPEN' || outcome === null || outcome === undefined) {
        logInfo(`[${asset}] Not recording - trade is still ${outcome || 'ACTIVE'}`);
        return;
    }
    
    // ✅ FIX #2: Prevent duplicates
    if (setup.recorded === true) {
        logInfo(`[${asset}] Already recorded - skipping duplicate`);
        return;
    }
    
    // ✅ FIX #3: Check database for duplicates
    const exists = tradeDatabase.trades.some(t => 
        t.asset === asset && 
        Math.abs((t.setup?.entryPrice || t.entryPrice || 0) - (setup.entryPrice || 0)) < 0.5 &&
        t.outcome && t.outcome === outcome
    );
    
    if (exists) {
        logInfo(`[${asset}] Duplicate trade detected - skipping`);
        return;
    }
    
    // ✅ FIX #4: Mark as recorded immediately
    setup.recorded = true;
    
    logSuccess(`✅ RECORDING ${asset.toUpperCase()} ${outcome}`, {
        entry: setup.entryPrice,
        profit: profit,
        total: tradeDatabase.trades.length
    });
    
    // Calculate P&L
    let realizedPnL = 0;
    if (outcome === 'WIN') {
        const stopDistancePercent = Math.abs((setup.stop - setup.entryPrice) / setup.entryPrice);
        const targetDistancePercent = Math.abs((setup.t2 - setup.entryPrice) / setup.entryPrice);
        if (stopDistancePercent > 0 && targetDistancePercent > 0) {
            const positionValueAtRisk = CONFIG.RISK_PER_TRADE / stopDistancePercent;
            realizedPnL = positionValueAtRisk * targetDistancePercent;
        } else {
            realizedPnL = CONFIG.RISK_PER_TRADE * 3;
        }
    } else if (outcome === 'LOSS') {
        realizedPnL = -CONFIG.RISK_PER_TRADE;
    }
    
    if (isNaN(realizedPnL) || !isFinite(realizedPnL)) {
        realizedPnL = 0;
    }
    
    const trade = {
        asset,
        setup,
        outcome,
        profit: realizedPnL,
        timestamp: setup.timestamp || Date.now(),
        marketCondition: setup.marketCondition || marketCondition,
        volatilityLevel: setup.volatilityLevel || volatilityLevel,
        sessionActive: setup.sessionActive || getCurrentSession()
    };
    
    tradeDatabase.trades.push(trade);
    tradeDatabase.performance.totalTrades = tradeDatabase.trades.length;
    
    if (outcome === 'WIN') {
        tradeDatabase.performance.winners++;
        const totalWins = tradeDatabase.trades.filter(t => t.outcome === 'WIN').reduce((sum, t) => sum + Math.abs(t.profit || 0), 0);
        tradeDatabase.performance.avgWin = tradeDatabase.performance.winners > 0 ? totalWins / tradeDatabase.performance.winners : 0;
    } else if (outcome === 'LOSS') {
        tradeDatabase.performance.losers++;
        const totalLosses = tradeDatabase.trades.filter(t => t.outcome === 'LOSS').reduce((sum, t) => sum + Math.abs(t.profit || 0), 0);
        tradeDatabase.performance.avgLoss = tradeDatabase.performance.losers > 0 ? totalLosses / tradeDatabase.performance.losers : 0;
    } else if (outcome === 'BREAKEVEN') {
        tradeDatabase.performance.breakevenTrades++;
    }
    
    tradeDatabase.performance.winRate = tradeDatabase.performance.totalTrades > 0 
        ? (tradeDatabase.performance.winners / tradeDatabase.performance.totalTrades) * 100 : 0;
    
    const totalWinsAmount = tradeDatabase.trades.filter(t => t.outcome === 'WIN').reduce((sum, t) => sum + Math.abs(t.profit || 0), 0);
    const totalLossesAmount = tradeDatabase.trades.filter(t => t.outcome === 'LOSS').reduce((sum, t) => sum + Math.abs(t.profit || 0), 0);
    tradeDatabase.performance.profitFactor = totalLossesAmount > 0 ? totalWinsAmount / totalLossesAmount : (totalWinsAmount > 0 ? Infinity : 0);
    
    await saveToVPS();
}

// ============================================
// TRADE GENERATION
// ============================================
function calculateSetupLevels(asset, price, direction, config) {
    const entry = {
        min: price * (direction === 'BULLISH' ? 0.9995 : 1.0005),
        max: price * (direction === 'BULLISH' ? 1.0005 : 0.9995)
    };
    let stop, t1, t2;
    if (direction === 'BULLISH') {
        stop = price * (1 - config.stopPct);
        t1 = price * (1 + (config.stopPct * config.target1));
        t2 = price * (1 + (config.stopPct * config.target2));
    } else {
        stop = price * (1 + config.stopPct);
        t1 = price * (1 - (config.stopPct * config.target1));
        t2 = price * (1 - (config.stopPct * config.target2));
    }
    return { entry, stop, t1, t2, entryPrice: price };
}

async function generateAISetup(asset, price, confidence, momentum, smcData = null) {
    const direction = momentum > 0 ? 'BULLISH' : 'BEARISH';
    const config = RISK_CONFIGS[riskMode];
    const setup = calculateSetupLevels(asset, price, direction, config);
    
    setup.confidence = smcData ? smcData.confluence?.totalScore || confidence : confidence;
    setup.direction = direction;
    setup.timestamp = Date.now();
    setup.entryPrice = price;
    setup.status = 'ACTIVE';
    setup.reachedTarget1 = false;
    setup.reachedTarget2 = false;
    setup.marketCondition = marketCondition;
    setup.volatilityLevel = volatilityLevel;
    setup.sessionActive = getCurrentSession();
    
    if (smcData) {
        setup.smcData = smcData;
        setup.confluenceScore = smcData.confluence?.totalScore || 0;
        setup.confluenceRating = smcData.confluence?.qualityRating || 'UNKNOWN';
    }
    
    // ✅ FIX #2: DO NOT add to trades array on entry
    // Only add to activeTrades
    activeTrades[asset] = setup;
    tradeDatabase.activeTrades[asset] = setup;
    
    await saveToVPS();
    
    logSuccess(`🚀 Trade opened: ${asset.toUpperCase()} ${direction} @ ${price.toFixed(2)}`);
    logInfo(`   Entry: ${setup.entryPrice.toFixed(2)}, T1: ${setup.t1.toFixed(2)}, T2: ${setup.t2.toFixed(2)}, Stop: ${setup.stop.toFixed(2)}`);
}

// ============================================
// SIGNAL SCANNING
// ============================================
function calculateMomentum(asset) {
    if (!priceHistory[asset] || priceHistory[asset].length < 3) {
        return Math.random() > 0.5 ? 1 : -1;
    }
    const recent = priceHistory[asset].slice(-3);
    const avgChange = recent.reduce((sum, p) => sum + (p.change || 0), 0) / recent.length;
    return Math.max(-2, Math.min(2, avgChange / 2));
}

async function scanForSignals(asset, currentPrice) {
    const timeSinceLastSignal = Date.now() - lastSignalTime[asset];
    if (timeSinceLastSignal < 60000) return;
    
    if (activeTrades[asset]) return;
    
    const momentum = calculateMomentum(asset);
    const direction = momentum > 0 ? 'BULLISH' : 'BEARISH';
    const config = RISK_CONFIGS[riskMode];
    
    let confidence = 8 + Math.floor(Math.random() * 8);
    if (marketCondition === 'TRENDING_UP' && momentum > 0) confidence += 2;
    if (marketCondition === 'TRENDING_DOWN' && momentum < 0) confidence += 2;
    if (volatilityLevel === 'HIGH' || volatilityLevel === 'EXTREME') confidence += 3;
    
    if (confidence >= config.minConfidence) {
        await generateAISetup(asset, currentPrice, confidence, momentum);
        lastSignalTime[asset] = Date.now();
    }
}

// ============================================
// TRADE EXIT MONITORING
// ============================================
async function updateTradeStatus(asset) {
    const trade = activeTrades[asset];
    if (!trade) return;
    
    const currentPrice = currentPrices[asset];
    if (!currentPrice || currentPrice <= 0) return;
    
    const entryAvg = (trade.entry?.min + trade.entry?.max) / 2 || trade.entryPrice;
    
    // TARGET 1 HIT
    if (!trade.reachedTarget1 &&
        ((trade.direction === 'BULLISH' && currentPrice >= trade.t1) ||
         (trade.direction === 'BEARISH' && currentPrice <= trade.t1))) {
        trade.reachedTarget1 = true;
        trade.originalStop = trade.stop;
        trade.stop = entryAvg; // Move to breakeven
        await saveToVPS();
        logSuccess(`🎯 [${asset.toUpperCase()}] TARGET 1 HIT - Stop moved to breakeven`);
        return;
    }
    
    // TARGET 2 HIT (WIN)
    if (trade.reachedTarget1 && !trade.reachedTarget2 &&
        ((trade.direction === 'BULLISH' && currentPrice >= trade.t2) ||
         (trade.direction === 'BEARISH' && currentPrice <= trade.t2))) {
        const profit = Math.abs(trade.t2 - entryAvg);
        await recordTradeOutcome(asset, trade, 'WIN', profit);
        // ✅ FIX #3: Clear immediately
        activeTrades[asset] = null;
        tradeDatabase.activeTrades[asset] = null;
        await saveToVPS();
        logSuccess(`🚀 [${asset.toUpperCase()}] TARGET 2 HIT - WIN: +$${profit.toFixed(2)}`);
        return;
    }
    
    // BREAKEVEN STOP HIT
    if (trade.reachedTarget1 && !trade.reachedTarget2 &&
        ((trade.direction === 'BULLISH' && currentPrice <= trade.stop) ||
         (trade.direction === 'BEARISH' && currentPrice >= trade.stop))) {
        await recordTradeOutcome(asset, trade, 'BREAKEVEN', 0);
        activeTrades[asset] = null;
        tradeDatabase.activeTrades[asset] = null;
        await saveToVPS();
        logInfo(`🔄 [${asset.toUpperCase()}] BREAKEVEN STOP HIT`);
        return;
    }
    
    // STOP LOSS HIT (before T1)
    if (!trade.reachedTarget1 &&
        ((trade.direction === 'BULLISH' && currentPrice <= (trade.originalStop || trade.stop)) ||
         (trade.direction === 'BEARISH' && currentPrice >= (trade.originalStop || trade.stop)))) {
        const loss = Math.abs(currentPrice - entryAvg);
        await recordTradeOutcome(asset, trade, 'LOSS', loss);
        activeTrades[asset] = null;
        tradeDatabase.activeTrades[asset] = null;
        await saveToVPS();
        logWarn(`❌ [${asset.toUpperCase()}] STOP LOSS HIT: -$10`);
        return;
    }
}

// ============================================
// ADAPTIVE SCAN
// ============================================
async function adaptiveScan() {
    detectMarketCondition();
    
    for (const asset of ['btc', 'eth']) {
        if (currentPrices[asset] > 0) {
            // Check exits first
            await updateTradeStatus(asset);
            // Then scan for new signals
            if (!activeTrades[asset]) {
                await scanForSignals(asset, currentPrices[asset]);
            }
        }
    }
}

// ============================================
// HELPERS
// ============================================
function getCurrentSession() {
    const hour = new Date().getUTCHours();
    if (hour >= 22 || hour < 7) return 'SYDNEY';
    if (hour >= 0 && hour < 9) return 'TOKYO';
    if (hour >= 8 && hour < 17) return 'LONDON';
    if (hour >= 13 && hour < 22) return 'NEW_YORK';
    return 'OVERLAP';
}

// ============================================
// DATA PERSISTENCE
// ============================================
async function loadFromVPS() {
    try {
        const response = await axios.get(`${CONFIG.API_BASE}/api/data`, { timeout: 5000 });
        if (response.data) {
            Object.assign(tradeDatabase, response.data);
            if (response.data.activeTrades) {
                activeTrades = response.data.activeTrades;
            }
            logInfo(`Loaded ${tradeDatabase.trades.length} trades from VPS`);
            return true;
        }
    } catch (err) {
        logWarn('VPS load failed', { error: err.message });
    }
    return false;
}

async function saveToVPS() {
    try {
        const dataToSave = {
            ...tradeDatabase,
            activeTrades: activeTrades,
            timestamp: Date.now()
        };
        await axios.post(`${CONFIG.API_BASE}/api/data`, dataToSave, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        });
    } catch (err) {
        logError('VPS save failed', { error: err.message });
    }
}

// ============================================
// API SERVER (Serves data to browser)
// ============================================
const app = express();
app.use(express.json());

app.get('/api/data', (req, res) => {
    res.json({
        trades: tradeDatabase.trades,
        activeTrades: activeTrades,
        performance: tradeDatabase.performance,
        currentPrices: currentPrices
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        activeTrades: Object.keys(activeTrades).filter(k => activeTrades[k]).length,
        totalTrades: tradeDatabase.trades.length,
        uptime: process.uptime()
    });
});

app.get('/api/trades/csv', (req, res) => {
    const rows = tradeDatabase.trades || [];
    const headers = [
        'timestamp','asset','direction','entry_min','entry_max','stop','t1','t2',
        'entryPrice','outcome','profit','marketCondition','volatilityLevel','sessionActive'
    ];
    
    const escape = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    
    const formatTimestamp = (ms) => {
        if (!ms) return '';
        const d = new Date(ms);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    };
    
    const csv = [headers.join(',')].concat(rows.map(tr => {
        const s = tr.setup || tr;
        const timestamp = s.timestamp || tr.timestamp || '';
        return [
            formatTimestamp(timestamp) || timestamp,
            tr.asset || '',
            s.direction || '',
            s.entry?.min ?? '',
            s.entry?.max ?? '',
            s.stop ?? '',
            s.t1 ?? '',
            s.t2 ?? '',
            s.entryPrice || '',
            tr.outcome || '',
            tr.profit ?? '',
            tr.marketCondition || '',
            tr.volatilityLevel || '',
            tr.sessionActive || ''
        ].map(escape).join(',');
    })).join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="nexus_trades_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
});

// ============================================
// MAIN EXECUTION
// ============================================
async function main() {
    logInfo('🚀 NEXUS Trading Engine Starting...');
    
    // Ensure directories exist
    try {
        await fs.mkdir(path.dirname(CONFIG.DATA_FILE), { recursive: true });
        await fs.mkdir(path.dirname(CONFIG.LOG_FILE), { recursive: true });
    } catch (err) {}
    
    // Load existing data
    await loadFromVPS();
    
    // Connect to Binance
    connectBinance();
    
    // Start API server
    app.listen(CONFIG.API_PORT, () => {
        logSuccess(`✅ API running on port ${CONFIG.API_PORT}`);
    });
    
    // Start trading loop
    setInterval(adaptiveScan, CONFIG.SCAN_INTERVAL_MS);
    
    // Initial scan
    await adaptiveScan();
    
    logSuccess('✅ Trading engine active');
    
    // Graceful shutdown
    process.on('SIGTERM', async () => {
        logInfo('Shutting down gracefully');
        if (ws) ws.close();
        await saveToVPS();
        process.exit(0);
    });
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = { recordTradeOutcome, generateAISetup, updateTradeStatus };

