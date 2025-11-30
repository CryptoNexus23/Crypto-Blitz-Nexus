#!/usr/bin/env node
/**
 * NEXUS 4.0 - AUTONOMOUS TRADE EXIT ENGINE
 * 
 * This server-side module handles ALL trade exits independently of the browser.
 * It runs every 5 seconds, checks active trades, and completes them when targets are hit.
 * 
 * Dependencies: axios (npm install axios)
 * 
 * Run with PM2: pm2 start nexus_exit_engine.js --name nexus-exit-engine
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    API_PORT: 3001,
    API_BASE: 'http://localhost:3001',
    CHECK_INTERVAL_MS: 5000, // Check every 5 seconds
    PRICE_API_TIMEOUT: 5000,
    LOG_FILE: '/opt/nexus/logs/exit_engine.log',
    DATA_FILE: '/opt/nexus/data/trades.json'
};

// Binance API endpoints for price fetching
const BINANCE_PRICE_URL = 'https://api.binance.com/api/v3/ticker/price';
const COINBASE_PRICE_URL = 'https://api.coinbase.com/v2/exchange-rates';

// ============================================
// LOGGING SYSTEM
// ============================================
class Logger {
    constructor(logFile) {
        this.logFile = logFile;
        this.ensureLogDir();
    }

    async ensureLogDir() {
        const logDir = path.dirname(this.logFile);
        try {
            await fs.mkdir(logDir, { recursive: true });
        } catch (err) {
            // Directory might already exist
        }
    }

    formatTimestamp() {
        return new Date().toISOString().replace('T', ' ').substring(0, 19);
    }

    async log(level, message, data = null) {
        const timestamp = this.formatTimestamp();
        const logEntry = `[${timestamp}] [${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`;
        
        // Console output
        console.log(logEntry);
        
        // File output
        try {
            await fs.appendFile(this.logFile, logEntry + '\n', 'utf8');
        } catch (err) {
            console.error('Failed to write to log file:', err.message);
        }
    }

    info(message, data) { return this.log('INFO', message, data); }
    warn(message, data) { return this.log('WARN', message, data); }
    error(message, data) { return this.log('ERROR', message, data); }
    success(message, data) { return this.log('SUCCESS', message, data); }
}

const logger = new Logger(CONFIG.LOG_FILE);

// ============================================
// PRICE FETCHING
// ============================================
class PriceFetcher {
    constructor() {
        this.lastPrices = { btc: 0, eth: 0 };
        this.lastUpdate = null;
        this.apiFailures = 0;
    }

    async fetchBinancePrices() {
        try {
            const response = await axios.get(BINANCE_PRICE_URL, {
                params: { symbols: '["BTCUSDT","ETHUSDT"]' },
                timeout: CONFIG.PRICE_API_TIMEOUT
            });

            const prices = {};
            if (Array.isArray(response.data)) {
                response.data.forEach(item => {
                    const symbol = item.symbol.toLowerCase();
                    if (symbol.includes('btcusdt')) {
                        prices.btc = parseFloat(item.price);
                    } else if (symbol.includes('ethusdt')) {
                        prices.eth = parseFloat(item.price);
                    }
                });
            }

            if (prices.btc > 0 && prices.eth > 0) {
                this.lastPrices = prices;
                this.lastUpdate = Date.now();
                this.apiFailures = 0;
                return prices;
            }

            throw new Error('Invalid price data from Binance');
        } catch (err) {
            this.apiFailures++;
            logger.warn(`Binance API error (failure #${this.apiFailures}): ${err.message}`);
            
            // Fallback to Coinbase if Binance fails
            if (this.apiFailures >= 3) {
                return await this.fetchCoinbasePrices();
            }
            
            return null;
        }
    }

    async fetchCoinbasePrices() {
        try {
            const [btcResponse, ethResponse] = await Promise.all([
                axios.get(`${COINBASE_PRICE_URL}?currency=BTC`, { timeout: CONFIG.PRICE_API_TIMEOUT }),
                axios.get(`${COINBASE_PRICE_URL}?currency=ETH`, { timeout: CONFIG.PRICE_API_TIMEOUT })
            ]);

            const prices = {
                btc: parseFloat(btcResponse.data.data.rates.USD),
                eth: parseFloat(ethResponse.data.data.rates.USD)
            };

            if (prices.btc > 0 && prices.eth > 0) {
                this.lastPrices = prices;
                this.lastUpdate = Date.now();
                this.apiFailures = 0;
                logger.info('Fallback: Using Coinbase prices');
                return prices;
            }

            throw new Error('Invalid price data from Coinbase');
        } catch (err) {
            logger.error(`Coinbase API error: ${err.message}`);
            return null;
        }
    }

    async getCurrentPrices() {
        const prices = await this.fetchBinancePrices();
        
        // If API fails, use last known prices (if recent)
        if (!prices && this.lastUpdate && (Date.now() - this.lastUpdate) < 30000) {
            logger.warn('Using stale prices (API unavailable)');
            return this.lastPrices;
        }
        
        return prices;
    }
}

// ============================================
// TRADE DATA MANAGEMENT
// ============================================
class TradeDatabase {
    constructor() {
        this.data = {
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
            }
        };
    }

    async load() {
        try {
            // Try to load from API first
            const response = await axios.get(`${CONFIG.API_BASE}/api/data`, {
                timeout: 5000
            });
            
            if (response.data && response.data.trades) {
                this.data = response.data;
                logger.info(`Loaded ${this.data.trades.length} trades from API`);
                return true;
            }
        } catch (err) {
            logger.warn(`API load failed: ${err.message}, trying file system`);
        }

        // Fallback to file system
        try {
            const fileData = await fs.readFile(CONFIG.DATA_FILE, 'utf8');
            this.data = JSON.parse(fileData);
            logger.info(`Loaded ${this.data.trades.length} trades from file system`);
            return true;
        } catch (err) {
            if (err.code !== 'ENOENT') {
                logger.error(`File load error: ${err.message}`);
            }
        }

        return false;
    }

    async save() {
        try {
            // Save to API
            await axios.post(`${CONFIG.API_BASE}/api/data`, this.data, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000
            });
            logger.info('Saved trade data to API');
        } catch (err) {
            logger.warn(`API save failed: ${err.message}`);
        }

        // Also save to file as backup
        try {
            const dataDir = path.dirname(CONFIG.DATA_FILE);
            await fs.mkdir(dataDir, { recursive: true });
            await fs.writeFile(CONFIG.DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
        } catch (err) {
            logger.error(`File save error: ${err.message}`);
        }
    }

    getActiveTrades() {
        const active = {};
        if (this.data.activeTrades?.btc) active.btc = this.data.activeTrades.btc;
        if (this.data.activeTrades?.eth) active.eth = this.data.activeTrades.eth;
        return active;
    }

    recordTradeOutcome(asset, trade, outcome, profit, exitPrice) {
        const RISK_PER_TRADE = 10; // $10 risk per trade

        // Calculate P&L
        let realizedPnL = 0;
        if (outcome === 'WIN') {
            const stopDistancePercent = Math.abs((trade.setup.stop - trade.setup.entryPrice) / trade.setup.entryPrice);
            const targetDistancePercent = Math.abs((trade.setup.t2 - trade.setup.entryPrice) / trade.setup.entryPrice);
            
            if (stopDistancePercent > 0 && targetDistancePercent > 0) {
                const positionValueAtRisk = RISK_PER_TRADE / stopDistancePercent;
                realizedPnL = positionValueAtRisk * targetDistancePercent;
            } else {
                realizedPnL = RISK_PER_TRADE * 3; // 3:1 R:R fallback
            }
        } else if (outcome === 'LOSS') {
            realizedPnL = -RISK_PER_TRADE;
        } else if (outcome === 'BREAKEVEN') {
            realizedPnL = 0;
        }

        // Update trade record
        const tradeRecord = this.data.trades.find(t => 
            t.asset === asset && 
            t.setup?.timestamp === trade.setup.timestamp &&
            !t.outcome
        );

        if (tradeRecord) {
            tradeRecord.outcome = outcome;
            tradeRecord.profit = realizedPnL;
            tradeRecord.exitPrice = exitPrice;
            tradeRecord.exitTime = Date.now();
            tradeRecord.closedBy = 'AUTONOMOUS_EXIT_ENGINE';
        } else {
            // Create new trade record if not found
            const newTrade = {
                asset,
                timestamp: trade.setup.timestamp,
                setup: trade.setup,
                outcome,
                profit: realizedPnL,
                exitPrice,
                exitTime: Date.now(),
                closedBy: 'AUTONOMOUS_EXIT_ENGINE',
                marketCondition: trade.setup.marketCondition || '',
                volatilityLevel: trade.setup.volatilityLevel || '',
                sessionActive: trade.setup.sessionActive || '',
                // Include all SMC data
                ...trade.setup.smcData ? {
                    obDetected: !!trade.setup.smcData.orderBlock,
                    fvgDetected: !!trade.setup.smcData.fvg,
                    marketStructureTrend: trade.setup.smcData.marketStructure?.trend || '',
                    confluenceScore: trade.setup.confluenceScore || 0,
                    confluenceRating: trade.setup.confluenceRating || 'UNKNOWN'
                } : {}
            };
            this.data.trades.push(newTrade);
        }

        // Update performance metrics
        this.data.performance.totalTrades = this.data.trades.length;
        
        if (outcome === 'WIN') {
            this.data.performance.winners++;
            const totalWins = this.data.trades
                .filter(t => t.outcome === 'WIN')
                .reduce((sum, t) => sum + Math.abs(t.profit || 0), 0);
            this.data.performance.avgWin = this.data.performance.winners > 0 
                ? totalWins / this.data.performance.winners 
                : 0;
        } else if (outcome === 'LOSS') {
            this.data.performance.losers++;
            const totalLosses = this.data.trades
                .filter(t => t.outcome === 'LOSS')
                .reduce((sum, t) => sum + Math.abs(t.profit || 0), 0);
            this.data.performance.avgLoss = this.data.performance.losers > 0 
                ? totalLosses / this.data.performance.losers 
                : 0;
        } else if (outcome === 'BREAKEVEN') {
            this.data.performance.breakevenTrades++;
        }

        // Calculate win rate
        this.data.performance.winRate = this.data.performance.totalTrades > 0
            ? (this.data.performance.winners / this.data.performance.totalTrades) * 100
            : 0;

        // Calculate profit factor
        const totalWins = this.data.trades
            .filter(t => t.outcome === 'WIN')
            .reduce((sum, t) => sum + Math.abs(t.profit || 0), 0);
        const totalLosses = this.data.trades
            .filter(t => t.outcome === 'LOSS')
            .reduce((sum, t) => sum + Math.abs(t.profit || 0), 0);
        this.data.performance.profitFactor = totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? 999 : 0);

        // Calculate breakeven rate
        this.data.performance.breakevenRate = this.data.performance.totalTrades > 0
            ? (this.data.performance.breakevenTrades / this.data.performance.totalTrades) * 100
            : 0;

        // Calculate total profit
        this.data.performance.totalProfit = this.data.trades
            .reduce((sum, t) => sum + (t.profit || 0), 0);
    }

    clearActiveTrade(asset) {
        if (this.data.activeTrades) {
            this.data.activeTrades[asset] = null;
        }
    }
}

// ============================================
// AUTONOMOUS EXIT ENGINE
// ============================================
class ExitEngine {
    constructor() {
        this.priceFetcher = new PriceFetcher();
        this.database = new TradeDatabase();
        this.isRunning = false;
        this.cycleCount = 0;
    }

    async initialize() {
        logger.info('🚀 Initializing Nexus Exit Engine...');
        
        const loaded = await this.database.load();
        if (!loaded) {
            logger.warn('No existing trade data found - starting fresh');
        }

        logger.success('Exit Engine initialized successfully');
    }

    async checkTradeExits(prices) {
        const activeTrades = this.database.getActiveTrades();
        const assets = ['btc', 'eth'];
        
        for (const asset of assets) {
            const trade = activeTrades[asset];
            if (!trade) continue;

            // Handle both formats: { setup: {...} } or direct setup object
            const setup = trade.setup || trade;
            if (!setup || !setup.entryPrice) {
                logger.warn(`[${asset.toUpperCase()}] Invalid trade structure`);
                continue;
            }

            const currentPrice = prices[asset];
            if (!currentPrice || currentPrice <= 0) {
                logger.warn(`[${asset.toUpperCase()}] No valid price data`);
                continue;
            }
            const entryPrice = setup.entryPrice || ((setup.entry?.min + setup.entry?.max) / 2);
            const entryAvg = (setup.entry?.min + setup.entry?.max) / 2;

            logger.info(`[${asset.toUpperCase()}] Exit Check - Entry: ${entryPrice}, T1: ${setup.t1}, T2: ${setup.t2}, Stop: ${setup.stop}, Current: ${currentPrice}`);

            // TARGET 1 HIT (Move stop to breakeven)
            if (!setup.reachedTarget1) {
                const t1Hit = setup.direction === 'BULLISH' 
                    ? currentPrice >= setup.t1 
                    : currentPrice <= setup.t1;

                if (t1Hit) {
                    logger.success(`🎯 [${asset.toUpperCase()}] TARGET 1 HIT! Moving stop to breakeven`);
                    
                    setup.reachedTarget1 = true;
                    setup.originalStop = setup.stop;
                    setup.stop = entryAvg;
                    
                    // Update in database - preserve original structure
                    if (this.database.data.activeTrades) {
                        // Update the setup object (handles both formats)
                        if (trade.setup) {
                            trade.setup = setup;
                        } else {
                            // Direct setup format - update it directly
                            Object.assign(trade, setup);
                        }
                        this.database.data.activeTrades[asset] = trade;
                    }
                    
                    await this.database.save();
                    continue;
                }
            }

            // TARGET 2 HIT (Full win)
            if (setup.reachedTarget1 && !setup.reachedTarget2) {
                const t2Hit = setup.direction === 'BULLISH' 
                    ? currentPrice >= setup.t2 
                    : currentPrice <= setup.t2;

                if (t2Hit) {
                    const profit = Math.abs(setup.t2 - entryAvg);
                    logger.success(`🚀 [${asset.toUpperCase()}] TARGET 2 HIT! Full WIN: +$${profit.toFixed(2)}`);
                    
                    // Ensure trade object has setup structure for recordTradeOutcome
                    const tradeRecord = trade.setup ? trade : { setup: trade };
                    this.database.recordTradeOutcome(asset, tradeRecord, 'WIN', profit, currentPrice);
                    this.database.clearActiveTrade(asset);
                    await this.database.save();
                    
                    continue;
                }

                // BREAKEVEN STOP HIT (After T1)
                const breakevenHit = setup.direction === 'BULLISH' 
                    ? currentPrice <= setup.stop 
                    : currentPrice >= setup.stop;

                if (breakevenHit) {
                    logger.info(`🔄 [${asset.toUpperCase()}] BREAKEVEN STOP HIT - Capital protected`);
                    
                    const tradeRecord = trade.setup ? trade : { setup: trade };
                    this.database.recordTradeOutcome(asset, tradeRecord, 'BREAKEVEN', 0, currentPrice);
                    this.database.clearActiveTrade(asset);
                    await this.database.save();
                    
                    continue;
                }
            }

            // STOP LOSS HIT (Before T1)
            if (!setup.reachedTarget1) {
                const stopPrice = setup.originalStop || setup.stop;
                const stopHit = setup.direction === 'BULLISH' 
                    ? currentPrice <= stopPrice 
                    : currentPrice >= stopPrice;

                if (stopHit) {
                    const loss = Math.abs(currentPrice - entryAvg);
                    logger.warn(`❌ [${asset.toUpperCase()}] STOP LOSS HIT: -$${loss.toFixed(2)}`);
                    
                    const tradeRecord = trade.setup ? trade : { setup: trade };
                    this.database.recordTradeOutcome(asset, tradeRecord, 'LOSS', loss, currentPrice);
                    this.database.clearActiveTrade(asset);
                    await this.database.save();
                    
                    continue;
                }
            }
        }
    }

    async runCycle() {
        try {
            this.cycleCount++;
            
            // Fetch current prices
            const prices = await this.priceFetcher.getCurrentPrices();
            if (!prices || (!prices.btc && !prices.eth)) {
                logger.warn('No price data available - skipping cycle');
                return;
            }

            // Check for trade exits
            await this.checkTradeExits(prices);

            if (this.cycleCount % 12 === 0) { // Every 60 seconds
                logger.info(`Exit Engine running - Cycle #${this.cycleCount}, Active trades: ${Object.keys(this.database.getActiveTrades()).length}`);
            }
        } catch (err) {
            logger.error(`Exit cycle error: ${err.message}`, err.stack);
        }
    }

    async start() {
        if (this.isRunning) {
            logger.warn('Exit Engine already running');
            return;
        }

        await this.initialize();
        this.isRunning = true;

        logger.success('✅ Exit Engine started - Monitoring trades every 5 seconds');

        // Initial cycle
        await this.runCycle();

        // Start interval
        this.intervalId = setInterval(async () => {
            await this.runCycle();
        }, CONFIG.CHECK_INTERVAL_MS);
    }

    stop() {
        if (!this.isRunning) return;
        
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        
        logger.info('Exit Engine stopped');
    }
}

// ============================================
// MAIN EXECUTION
// ============================================
async function main() {
    const engine = new ExitEngine();

    // Graceful shutdown
    process.on('SIGTERM', () => {
        logger.info('Received SIGTERM - shutting down gracefully');
        engine.stop();
        process.exit(0);
    });

    process.on('SIGINT', () => {
        logger.info('Received SIGINT - shutting down gracefully');
        engine.stop();
        process.exit(0);
    });

    // Start the engine
    await engine.start();
}

// Run if executed directly
if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = { ExitEngine, PriceFetcher, TradeDatabase, Logger };

