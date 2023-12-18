const { createLogger, format, transports, config } = require("winston");
const { combine, timestamp, printf } = format;

const myFormat = printf(({ level, message, timestamp }) => {
  return JSON.stringify({
    timestamp,
    level,
    message,
  });
});

const logger = createLogger({
  levels: config.syslog.levels,
  format: combine(timestamp(), myFormat),
  transports: [
    new transports.Console(),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "info.log", level: "info" }),
    new winston.transports.File({ filename: "warning.log", level: "warning" }),
    new winston.transports.File({ filename: "debug.log", level: "debug" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

module.exports = { logger };
