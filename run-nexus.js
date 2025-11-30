const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log('🚀 Starting Nexus in headless mode...');
    
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });
    
    const page = await browser.newPage();
    
    page.on('console', msg => {
        const text = msg.text();
        console.log(`[NEXUS] ${text}`);
        fs.appendFileSync('/opt/nexus/nexus.log', 
            `${new Date().toISOString()} - ${text}\n`);
    });
    
    await page.goto('file:///opt/nexus/index.html', {
        waitUntil: 'networkidle2',
        timeout: 60000
    });
    
    console.log('✅ Nexus dashboard loaded successfully');
    console.log('📊 Bot is now running 24/7');
    console.log('📝 Logs: /opt/nexus/nexus.log');
    
    setInterval(async () => {
        try {
            const localStorageData = await page.evaluate(() => {
                return JSON.stringify(localStorage);
            });
            fs.writeFileSync('/opt/nexus/localStorage-backup.json', localStorageData, 'utf8');
            console.log('💾 localStorage backed up');
        } catch (error) {
            console.error('❌ Backup failed:', error);
        }
    }, 3600000);
    
    await new Promise(() => {});
})();
