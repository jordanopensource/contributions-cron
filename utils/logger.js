const { createLogger, format, transports, config } = require("winston");
const { colorize, combine, timestamp, label, printf } = format;

const jsonFormat = printf(({ level, message, label, timestamp }) => {
  return JSON.stringify({
    timestamp,
    label,
    level,
    message,
  });
});

const textFormat = printf(({ level, message, label, timestamp }) => {
  const separator = "-".repeat(label.length * 2);
  const centerPadding = " ".repeat(
    Math.abs(label.length * 2 - label.length) / 2.0,
  );
  return `${separator}\n${centerPadding}${label.toUpperCase()}\n${separator}\n[${level}] ${message} @ ${timestamp}`;
});

function newLogger(labelTitle, formatter) {
  return createLogger({
    levels: config.syslog.levels,
    format: combine(
      colorize(),
      timestamp(),
      label({ label: labelTitle }),
      formatter,
    ),
    transports: [new transports.Console()],
  });
}

module.exports = { jsonFormat, textFormat, newLogger };
