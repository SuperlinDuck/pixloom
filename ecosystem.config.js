module.exports = {
  apps: [{
    name: 'pixloom',
    script: 'node_modules/next/dist/bin/next',
    args: 'start',
    cwd: '/var/www/pixloom',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G'
  }]
}
