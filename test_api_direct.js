#!/usr/bin/env node
/**
 * Direct API test - run this on VPS to diagnose the issue
 * Run: node test_api_direct.js
 */

const crypto = require('crypto');
const axios = require('axios');

// Get from environment or use defaults
const API_KEY = process.env.BINANCE_API_KEY || 'EJVLvIGgQakW6Wm6rnH1JToahUEJXWKWvETrH0ahCBEsrTwjk92kVwWujHPesK8q';
const API_SECRET = process.env.BINANCE_SECRET || '6t3LXvAG2cAAmeh6aU05vXHaodthYeRD8HwWT6XJB9n0C2qlyCf6L9WXW9uklqDR';
const BASE_URL = 'https://testnet.binance.com/fapi/v1';

function signRequest(queryString) {
    return crypto
        .createHmac('sha256', API_SECRET)
        .update(queryString)
        .digest('hex');
}

async function testAPI() {
    console.log('========================================');
    console.log('BINANCE TESTNET API DIAGNOSTIC TEST');
    console.log('========================================\n');
    
    console.log('Configuration:');
    console.log(`  API Key: ${API_KEY.substring(0, 20)}...`);
    console.log(`  API Secret: ${API_SECRET ? API_SECRET.substring(0, 20) + '...' : 'NOT SET'}`);
    console.log(`  Base URL: ${BASE_URL}\n`);
    
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = signRequest(queryString);
    
    console.log('Request Details:');
    console.log(`  Timestamp: ${timestamp}`);
    console.log(`  Query String: ${queryString}`);
    console.log(`  Signature: ${signature.substring(0, 20)}...\n`);
    
    const url = `${BASE_URL}/account?timestamp=${timestamp}&signature=${signature}`;
    console.log(`Full URL: ${url}\n`);
    
    try {
        console.log('Making request...\n');
        
        const response = await axios.get(url, {
            headers: { 
                'X-MBX-APIKEY': API_KEY,
                'Content-Type': 'application/json'
            },
            validateStatus: function (status) {
                return status < 500;
            },
            timeout: 10000
        });
        
        console.log('Response Status:', response.status);
        console.log('Response Headers:', JSON.stringify(response.headers, null, 2));
        console.log('\nResponse Data Type:', typeof response.data);
        console.log('Response Data Length:', response.data ? (typeof response.data === 'string' ? response.data.length : Object.keys(response.data).length) : 'null');
        
        if (typeof response.data === 'string') {
            console.log('\nResponse is STRING:');
            console.log('  Length:', response.data.length);
            console.log('  Content:', response.data);
            console.log('  First 500 chars:', response.data.substring(0, 500));
            
            if (response.data.length === 0) {
                console.log('\n❌ ERROR: Empty string response!');
                console.log('This usually means:');
                console.log('  1. API key/secret is incorrect');
                console.log('  2. API key doesn\'t have Futures permissions');
                console.log('  3. IP whitelist is blocking the request');
                console.log('  4. Testnet account needs to be activated');
            }
        } else if (response.data && typeof response.data === 'object') {
            console.log('\n✅ Response is OBJECT:');
            console.log('  Keys:', Object.keys(response.data));
            console.log('  Full Response:', JSON.stringify(response.data, null, 2).substring(0, 1000));
            
            if (response.data.assets) {
                const usdt = response.data.assets.find(a => a.asset === 'USDT');
                if (usdt) {
                    console.log('\n✅ USDT Balance Found:');
                    console.log(`  Wallet Balance: ${usdt.walletBalance} USDT`);
                    console.log(`  Available: ${usdt.availableBalance} USDT`);
                }
            }
            if (response.data.totalMarginBalance) {
                console.log(`\n✅ Total Margin Balance: ${response.data.totalMarginBalance} USDT`);
            }
        } else {
            console.log('\nResponse Data:', response.data);
        }
        
        if (response.status >= 200 && response.status < 300) {
            console.log('\n✅ HTTP Status is OK (2xx)');
        } else {
            console.log(`\n⚠️  HTTP Status: ${response.status}`);
        }
        
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        if (error.response) {
            console.error('  Status:', error.response.status);
            console.error('  Data:', error.response.data);
            console.error('  Headers:', error.response.headers);
        } else if (error.request) {
            console.error('  No response received');
            console.error('  Request:', error.request);
        }
    }
}

testAPI().then(() => {
    console.log('\n========================================');
    console.log('Test complete');
    console.log('========================================');
    process.exit(0);
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

