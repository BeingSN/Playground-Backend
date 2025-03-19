const fs = require("fs");
const path = require("path");
const winston = require("winston");

// Define log directory inside the container
const logDir = path.join(__dirname, "../logs");

// Ensure the logs directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(), // Console logs (Docker captures these)
    new winston.transports.File({ filename: path.join(logDir, "app.log") }), // File logs
  ],
});

module.exports = logger;
