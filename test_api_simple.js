#!/usr/bin/env node
/**
 * Simple API test - test basic connectivity first
 */

const crypto = require('crypto');
const axios = require('axios');

const API_KEY = process.env.BINANCE_API_KEY || 'EJVLvIGgQakW6Wm6rnH1JToahUEJXWKWvETrH0ahCBEsrTwjk92kVwWujHPesK8q';
const API_SECRET = process.env.BINANCE_SECRET || '6t3LXvAG2cAAmeh6aU05vXHaodthYeRD8HwWT6XJB9n0C2qlyCf6L9WXW9uklqDR';

async function testPing() {
    console.log('Testing Binance Testnet connectivity...\n');
    try {
        const response = await axios.get('https://testnet.binance.com/fapi/v1/ping');
        console.log('✅ Ping successful:', response.data);
    } catch (error) {
        console.log('❌ Ping failed:', error.message);
    }
}

async function testTime() {
    console.log('\nTesting server time...\n');
    try {
        const response = await axios.get('https://testnet.binance.com/fapi/v1/time');
        console.log('✅ Server time:', new Date(response.data.serverTime));
    } catch (error) {
        console.log('❌ Time check failed:', error.message);
    }
}

async function testExchangeInfo() {
    console.log('\nTesting exchange info (no auth required)...\n');
    try {
        const response = await axios.get('https://testnet.binance.com/fapi/v1/exchangeInfo');
        console.log('✅ Exchange info received');
        console.log('  Symbols available:', response.data.symbols?.length || 0);
        const btcusdt = response.data.symbols?.find(s => s.symbol === 'BTCUSDT');
        if (btcusdt) {
            console.log('  BTCUSDT status:', btcusdt.status);
        }
    } catch (error) {
        console.log('❌ Exchange info failed:', error.message);
    }
}

async function testAccountWithAuth() {
    console.log('\nTesting account endpoint with authentication...\n');
    
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = crypto
        .createHmac('sha256', API_SECRET)
        .update(queryString)
        .digest('hex');
    
    const url = `https://testnet.binance.com/fapi/v1/account?timestamp=${timestamp}&signature=${signature}`;
    
    try {
        const response = await axios.get(url, {
            headers: { 
                'X-MBX-APIKEY': API_KEY,
                'Content-Type': 'application/json'
            },
            validateStatus: () => true // Don't throw on any status
        });
        
        console.log('Response Status:', response.status);
        console.log('Response Headers:', JSON.stringify(response.headers, null, 2));
        console.log('Response Data Type:', typeof response.data);
        
        if (typeof response.data === 'string') {
            console.log('Response Length:', response.data.length);
            if (response.data.length > 0) {
                console.log('Response Content:', response.data.substring(0, 500));
            } else {
                console.log('❌ EMPTY STRING RESPONSE');
                console.log('\nThis means:');
                console.log('  1. API key authentication is failing silently');
                console.log('  2. API key might not have Futures permissions');
                console.log('  3. Testnet account might need activation');
                console.log('  4. Try checking: https://testnet.binancefuture.com');
            }
        } else {
            console.log('Response Data:', JSON.stringify(response.data, null, 2).substring(0, 1000));
        }
        
    } catch (error) {
        console.log('❌ Error:', error.message);
        if (error.response) {
            console.log('  Status:', error.response.status);
            console.log('  Data:', error.response.data);
        }
    }
}

async function runTests() {
    await testPing();
    await testTime();
    await testExchangeInfo();
    await testAccountWithAuth();
    
    console.log('\n========================================');
    console.log('Recommendations:');
    console.log('========================================');
    console.log('1. Go to: https://testnet.binancefuture.com');
    console.log('2. Log in and check if your account is active');
    console.log('3. Go to: https://demo.binance.com/en/my/settings/api-management');
    console.log('4. Verify API key has:');
    console.log('   - Enable Reading: ✓');
    console.log('   - Enable Futures: ✓');
    console.log('5. If IP restriction is enabled, add: 5.223.52.88');
    console.log('========================================\n');
}

runTests();

