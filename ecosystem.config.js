module.exports = {
  apps: [{
    name: 'nexus-trading',
    script: '/opt/nexus/nexus_vps_trading_engine.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      BINANCE_API_KEY: 'EJVLvIGgQakW6Wm6rnH1JToahUEJXWKWvETrH0ahCBEsrTwjk92kVwWujHPesK8q',
      BINANCE_SECRET: '6t3LXvAG2cAAmeh6aU05vXHaodthYeRD8HwWT6XJB9n0C2qlyCf6L9WXW9uklqDR'
    },
    error_file: '/opt/nexus/logs/pm2-error.log',
    out_file: '/opt/nexus/logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};

