const path = require("path");

module.exports = {
  apps: [
    {
      name: "myblog",
      script: "apps/server/dist/index.js",
      cwd: __dirname,
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      error_file: path.join(__dirname, "data/logs/pm2-error.log"),
      out_file: path.join(__dirname, "data/logs/pm2-out.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
