// pm2 yapılandırması (CommonJS — pm2 require ile yükler)
module.exports = {
  apps: [
    {
      name: 'cinarkoy-excel-sync',
      script: './companion.js',
      cwd: '.',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 50,
      min_uptime: '5s',
      restart_delay: 1000,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
