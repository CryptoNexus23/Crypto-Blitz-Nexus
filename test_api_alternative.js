#!/usr/bin/env node
/**
 * Alternative API test - try different endpoints and methods
 */

const crypto = require('crypto');
const axios = require('axios');

const API_KEY = process.env.BINANCE_API_KEY || 'EJVLvIGgQakW6Wm6rnH1JToahUEJXWKWvETrH0ahCBEsrTwjk92kVwWujHPesK8q';
const API_SECRET = process.env.BINANCE_SECRET || '6t3LXvAG2cAAmeh6aU05vXHaodthYeRD8HwWT6XJB9n0C2qlyCf6L9WXW9uklqDR';

// Try different base URLs
const ENDPOINTS = [
    'https://testnet.binance.com/fapi/v1',
    'https://testnet.binancefuture.com/fapi/v1',
    'https://fapi.binance.com/fapi/v1' // Live endpoint (won't work but let's see the error)
];

function signRequest(queryString) {
    return crypto
        .createHmac('sha256', API_SECRET)
        .update(queryString)
        .digest('hex');
}

async function testEndpoint(baseUrl, name) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Testing: ${name}`);
    console.log(`Base URL: ${baseUrl}`);
    console.log('='.repeat(50));
    
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = signRequest(queryString);
    
    const url = `${baseUrl}/account?timestamp=${timestamp}&signature=${signature}`;
    
    try {
        const response = await axios.get(url, {
            headers: { 
                'X-MBX-APIKEY': API_KEY,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            validateStatus: () => true,
            timeout: 10000
        });
        
        console.log(`Status: ${response.status}`);
        console.log(`Response Type: ${typeof response.data}`);
        
        if (typeof response.data === 'string') {
            console.log(`Response Length: ${response.data.length}`);
            if (response.data.length > 0) {
                console.log(`Response: ${response.data.substring(0, 500)}`);
            } else {
                console.log('❌ Empty string');
            }
        } else if (response.data && typeof response.data === 'object') {
            console.log(`✅ Got object response!`);
            console.log(`Keys: ${Object.keys(response.data).join(', ')}`);
            if (response.data.totalMarginBalance) {
                console.log(`💰 Balance: ${response.data.totalMarginBalance} USDT`);
            }
            if (response.data.assets) {
                const usdt = response.data.assets.find(a => a.asset === 'USDT');
                if (usdt) {
                    console.log(`💰 USDT: ${usdt.walletBalance} USDT`);
                }
            }
        } else {
            console.log(`Response:`, response.data);
        }
        
        // Check for error codes in response
        if (response.data && response.data.code) {
            console.log(`⚠️  Error Code: ${response.data.code}`);
            console.log(`   Message: ${response.data.msg}`);
        }
        
    } catch (error) {
        console.log(`❌ Error: ${error.message}`);
        if (error.response) {
            console.log(`   Status: ${error.response.status}`);
            console.log(`   Data: ${JSON.stringify(error.response.data)}`);
        }
    }
}

async function runTests() {
    console.log('Testing different Binance API endpoints...\n');
    console.log(`API Key: ${API_KEY.substring(0, 20)}...`);
    console.log(`API Secret: ${API_SECRET ? API_SECRET.substring(0, 20) + '...' : 'NOT SET'}\n`);
    
    await testEndpoint(ENDPOINTS[0], 'Testnet Binance (testnet.binance.com)');
    await testEndpoint(ENDPOINTS[1], 'Testnet Binance Futures (testnet.binancefuture.com)');
    
    console.log('\n' + '='.repeat(50));
    console.log('RECOMMENDATION:');
    console.log('='.repeat(50));
    console.log('If all endpoints return empty strings, try:');
    console.log('1. Create a NEW API key directly on: https://testnet.binancefuture.com');
    console.log('2. Log into testnet.binancefuture.com first, then create API key');
    console.log('3. The demo.binance.com API keys might not work with testnet API');
    console.log('='.repeat(50));
}

runTests();

