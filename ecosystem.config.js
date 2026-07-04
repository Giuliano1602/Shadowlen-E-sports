module.exports = {
  apps: [
    {
      name: "discordbot",
      script: "index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      exp_backoff_restart_delay: 100,
      min_uptime: "10s",
      max_restarts: 50,
      restart_delay: 5000,
      time: true,
      env: {
        NODE_ENV: "production"
      },
      env_production: {
        NODE_ENV: "production"
      }
    }
  ]
};
