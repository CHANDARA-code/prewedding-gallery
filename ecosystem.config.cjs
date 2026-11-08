// pm2 process file for production: `pm2 startOrReload ecosystem.config.cjs`.
// Settings come from apps/api/.env.production (gitignored; see apps/api/.env.example).
const path = require('path');
const fs = require('fs');
const dotenv = require('./apps/api/node_modules/dotenv');

const apiDir = path.join(__dirname, 'apps/api');
const env = dotenv.parse(fs.readFileSync(path.join(apiDir, '.env.production')));

module.exports = {
  apps: [
    {
      name: 'prewedding-api',
      cwd: apiDir,
      script: 'dist/main.js',
      env,
      max_memory_restart: '700M',
      kill_timeout: 8000, // lets the shutdown alert flush and PRAGMA optimize run
    },
    {
      // Separate process so it can still alert when the API is down.
      name: 'prewedding-watchdog',
      cwd: apiDir,
      script: 'dist/alerts/watchdog.js',
      env: {
        ...env,
        WATCH_URLS: `http://127.0.0.1:${env.PORT}/api/v1/health,https://prewedding.leavchandara.com/api/v1/health`,
        WATCH_INTERVAL_S: '60',
        WATCH_FAILS: '2',
      },
    },
  ],
};
