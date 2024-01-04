const { createLogger, format, transports } = require("winston");
const { colorize, combine, timestamp, label, json, printf } = format;

require("dotenv").config({
  path: "./.env",
});

const colorizeOpt = {
  all: true,
  colors: { info: "white", warning: "yellow", error: "red" },
};

function newLogger(labelTitle) {
  if (process.env.LOG_TYPE === "json") {
    return createLogger({
      level: process.env.LOG_LEVEL || "info",
      format: combine(
        label({ label: labelTitle }),
        json(),
        colorize(colorizeOpt)
      ),
      transports: [new transports.Console()],
    });
  } else {
    return createLogger({
      level: process.env.LOG_LEVEL || "info",
      format: combine(
        colorize(colorizeOpt),
        label({ label: labelTitle }),
        printf(info => `[${info.label}] ${info.level}: ${info.message}`)
      ),
      transports: [new transports.Console()],
    });
  }
}

module.exports = { newLogger };
