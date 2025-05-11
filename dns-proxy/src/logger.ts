import winston from 'winston';

export function createLogger(logLevel: string) {
  return winston.createLogger({
    level: logLevel,
    format: winston.format.combine(
      // winston.format.timestamp(),
      winston.format.json(),
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        ),
      }),
    ],
  });
}
