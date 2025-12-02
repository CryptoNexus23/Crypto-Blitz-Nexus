# Nexus Trading Engine - File Structure & Operations

## Quick Reference

### 🔴 ACTIVE FILES (Currently Running)
- `nexus_vps_trading_engine.js` - Main bot (166 KB)
- `api-server.js` - Web API server
- `ecosystem.config.js` - PM2 configuration
- `data/trades.json` - Trade history (actively updated)

### 🟡 BACKUP & LEGACY FILES
- `nexus_vps_trading_engine.js.backup*` - Timestamped backups
- `nexus_exit_engine.js` - Legacy exit logic
- `nexus_trading_engine_complete.js` - Older version

### 📊 DATA STORAGE
- `data/trades.json` - Current trades (23 KB, Dec 1 21:33)
- `data/trades.json.backup` - Previous snapshot
- `logs/pm2-out.log` - Bot output logs
- `logs/pm2-error.log` - Error logs

### 🌐 WEB INTERFACE
- `index.html` - Dashboard UI (140 KB)
- `api-server.js` - REST API on port 3001

## Safe Change Workflow

1. **Backup first:**
   \`\`\`bash
   cp nexus_vps_trading_engine.js nexus_vps_trading_engine.js.backup.$(date +%Y%m%d_%H%M%S)
   \`\`\`

2. **Stop the bot:**
   \`\`\`bash
   pm2 stop nexus-trading
   \`\`\`

3. **Make your changes** to the file

4. **Commit to Git:**
   \`\`\`bash
   git add .
   git commit -m "Description of change"
   \`\`\`

5. **Start the bot:**
   \`\`\`bash
   pm2 start nexus_vps_trading_engine.js
   \`\`\`

6. **Monitor for errors:**
   \`\`\`bash
   pm2 logs nexus-trading --lines 50 --nostream
   \`\`\`

7. **Push to GitHub (Cloud Backup):**
   \`\`\`bash
   git push origin main
   \`\`\`

## Emergency Rollback

If something breaks:

\`\`\`bash
# See recent commits
git log --oneline -5

# Revert to previous version
git checkout HEAD~1 nexus_vps_trading_engine.js

# Restart bot
pm2 restart nexus-trading
\`\`\`

## Important: NEVER Delete These

1. `data/trades.json` - Your trading history (MOST CRITICAL)
2. `.git/` folder - Your version control
3. `.gitignore` - Prevents huge files from being pushed

## Common Commands

| Task | Command |
|------|---------|
| Check bot status | `pm2 status` |
| View live logs | `pm2 logs nexus-trading` |
| Restart bot | `pm2 restart nexus-trading` |
| Stop bot | `pm2 stop nexus-trading` |
| Check git status | `git status` |
| See recent changes | `git log --oneline -10` |
| Commit changes | `git add . && git commit -m "message"` |
| Push to GitHub | `git push origin main` |

---

**Next Priority:** Fix the error at line 3734 in nexus_vps_trading_engine.js
