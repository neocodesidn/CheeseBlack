const pino = require('pino');

// Logger console terstruktur: timestamp, level, dan metadata yang mudah dibaca.
// LOG_LEVEL dapat diatur melalui .env: trace, debug, info, warn, error, atau fatal.
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      levelFirst: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: true,
    },
  },
});

module.exports = logger;
