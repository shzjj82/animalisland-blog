const path = require("path");

module.exports = {
  apps: [
    {
      name: "myblog-api",
      script: "apps/server/dist/index.js",
      cwd: __dirname,
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
      error_file: path.join(__dirname, "data/logs/pm2-api-error.log"),
      out_file: path.join(__dirname, "data/logs/pm2-api-out.log"),
      merge_logs: true,
      time: true,
    },
    {
      name: "myblog-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 5173",
      cwd: path.join(__dirname, "apps/web"),
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 5173,
        HOSTNAME: "0.0.0.0",
        INTERNAL_API_URL: "http://127.0.0.1:3001",
      },
      error_file: path.join(__dirname, "data/logs/pm2-web-error.log"),
      out_file: path.join(__dirname, "data/logs/pm2-web-out.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
