<!DOCTYPE html>
<html lang="en">
<head>
  <!-- (unchanged head content omitted for brevity) -->
</head>
<body>
  <div class="header">
    <!-- Live-Demo toggle -->
    <div class="live" onclick="toggleLive()">
      <div class="dot" style="background:var(--red)"></div>
      <span id="modeStatus">DEMO MODE</span>
    </div>
    <h1>Crypto Blitz Nexus Pro 3.0</h1>
    <div class="subtitle">Self-Learning AI Scalping Terminal - Bulletproof Breakeven Strategy</div>
  </div>

  <!-- (unchanged controls, performance-panel, sessions, container panels) -->

  <div class="workspace">
    <div class="ws-header">🤖 AI Trade Journal - Bulletproof Edition <span style="color:#00ff88" id="connectionStatus">🟢 READY</span></div>
    <div class="ws-feed" id="feed">
      <div class="message"><div class="timestamp">00:00</div><strong>AI:</strong> Bulletproof breakeven strategy initialized - All issues resolved.</div>
    </div>
  </div>

  <script>
    // ▼ LIVE-TRADING PROXY INTEGRATION ▼
    const PROXY_URL = 'http://localhost:3001/api';
    let liveTradingEnabled = false;

    function toggleLive() {
      liveTradingEnabled = !liveTradingEnabled;
      document.getElementById('modeStatus').textContent = liveTradingEnabled ? 'LIVE TRADING' : 'DEMO MODE';
      document.querySelector('.live .dot').style.background = liveTradingEnabled ? 'var(--green)' : 'var(--red)';
      addTradeMessage(`🔀 Switched to ${liveTradingEnabled ? 'LIVE' : 'DEMO'} mode`, 'System');
    }

    async function executeSetup(asset) {
      if (!liveTradingEnabled) {
        addTradeMessage('ℹ️ Demo mode active. Toggle LIVE to place real orders.', 'System');
        return;
      }
      const statusText = document.getElementById(`${asset.toLowerCase()}-status`).textContent.toUpperCase();
      const side = statusText.includes('SHORT') ? 'SELL' : 'BUY';
      const entryText = document.getElementById(`${asset.toLowerCase()}-entry`).textContent;
      const price = parseFloat(entryText.replace(/[^0-9.]/g, '')) || 0;
      const quantity = asset === 'BTC' ? 0.001 : 0.01;

      const body = { symbol: asset + 'USDT', side, type: 'MARKET', quantity, price };

      try {
        const res = await fetch(`${PROXY_URL}/trade`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) {
          addTradeMessage(`⚠️ Trade failed: ${JSON.stringify(data)}`, 'System');
          console.error('Trade error:', data);
          return;
        }
        addTradeMessage(`✅ Live ${asset} order placed. OrderID: ${data.orderId}`, 'System');
        console.log('Live trade:', data);
      } catch (err) {
        addTradeMessage(`⚠️ Network error: ${err}`, 'System');
        console.error(err);
      }
    }

    // ===== EXISTING NEXUS CODE BELOW =====

    // (All your existing variables, init(), connectBinance(), scanForSignals(), etc.)

    function addTradeMessage(text, sender) {
      const feed = document.getElementById('feed');
      const el = document.createElement('div');
      el.className = 'message';
      el.innerHTML = `<div class="timestamp">${new Date().toLocaleTimeString()}</div><strong>${sender}:</strong> ${text}`;
      feed.appendChild(el);
      feed.scrollTop = feed.scrollHeight;
    }

    // Replace your existing executeSetup calls on buttons:
    // <button id="btc-alert" onclick="executeSetup('BTC')" ...>
    // <button id="eth-alert" onclick="executeSetup('ETH')" ...>

    // (Rest of your script remains unchanged)
    init();
  </script>
</body>
</html>
