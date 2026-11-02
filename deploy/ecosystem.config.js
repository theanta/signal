// pm2 config for one backend stack on the Oracle server. deploy/deploy.sh
// sets SIGNAL_STACK (beta or staging), which names the process; each stack
// is its own checkout, so the paths below point at that checkout's .env.
//
// The built server resolves its .env relative to dist/, where there is none,
// so dotenv is preloaded with an explicit path instead. dotenv never
// overrides a variable that is already set, so NODE_ENV=production here wins
// over whatever the .env says (it turns on secure, SameSite=None cookies).
// The port comes from BACKEND_PORT in the .env.
//
// Keep instances at 1: the cron jobs run inside this process, and a second
// instance would run every scheduled scrape twice.
const path = require('path');

const root = path.resolve(__dirname, '..');
const stack = process.env.SIGNAL_STACK;

if (stack !== 'beta' && stack !== 'staging') {
  throw new Error('SIGNAL_STACK must be beta or staging; run deploy/deploy.sh instead of pm2 directly');
}

module.exports = {
  apps: [
    {
      name: `signal-${stack}-backend`,
      cwd: path.join(root, 'backend'),
      script: 'dist/backend/api/server.js',
      node_args: '-r dotenv/config',
      instances: 1,
      max_memory_restart: '1G',
      time: true,
      env: {
        NODE_ENV: 'production',
        DOTENV_CONFIG_PATH: path.join(root, '.env'),
      },
    },
  ],
};
