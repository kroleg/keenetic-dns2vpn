import fs from 'fs';
import readline from 'readline';
import TailFile from '@logdna/tail-file';
import type { Logger } from 'winston';
import path from 'path';

export async function startFileWatcher(params: { logFilePath: string, onLine: (line: string) => void, logger: Logger }) {
  const { onLine, logger } = params;

  const logFilePath = path.resolve(params.logFilePath)

  logger.debug(`Tailing file: ${logFilePath}`);
  // Ensure the log file exists before watching, as @logdna/tail-file expects it.
  if (!fs.existsSync(logFilePath)) {
    logger.error(`Log file does not exist: ${logFilePath}`);
    process.exit(1);
    // try {
    //   fs.writeFileSync(logFilePath, '', { flag: 'a' }); // Create the file if it doesn't exist
    //   logger.debug(`Log file created: ${logFilePath}`);
    // } catch (err) {
    //   logger.error(`Error creating log file ${logFilePath}:`, err);
    //   process.exit(1); // Exit if we can't create the log file
    // }
  }

  // Instantiate TailFile
  // We pass encoding to the Readable stream options part of TailFile constructor
  const tail = new TailFile(logFilePath, { encoding: 'utf8', startPos: undefined }) // undefined startPos means tail from EOF by default
    .on('tail_error', (err: Error) => {
      logger.error('TailFile had an error!', err);
      // Depending on the error, you might want to exit or retry
    })
    .on('error', (err: Error) => { // Stream error
      logger.error('A TailFile stream error was encountered:', err);
    })
    .on('renamed', (details: any) => { // TODO: Find specific type for details if available
      logger.debug(`Log file renamed/rolled: ${details.filename}. Tailing will attempt to continue.`);
    })
    .on('truncated', (details: any) => { // TODO: Find specific type for details if available
      logger.debug(`Log file truncated: ${details.filename}. Tailing will restart from beginning.`);
    });

  // Use readline to process lines from the TailFile stream
  const rl = readline.createInterface({
    input: tail,
    crlfDelay: Infinity
  });

  rl.on('line', onLine);

  // Start tailing
  await tail.start()
  logger.debug(`Started tailing ${logFilePath}. Ready for new lines.`);

  // Graceful shutdown
  async function gracefulShutdown() {
    logger.debug('Attempting to gracefully shutdown tailing...');
    try {
      await tail.quit();
      logger.debug('TailFile watcher stopped.');
    } catch (err: any) { // err from tail.quit() might be specific, using any for now
      logger.error('Error during TailFile shutdown:', err);
    }
  }

  process.on('SIGINT', gracefulShutdown); // Ctrl+C
  process.on('SIGTERM', gracefulShutdown); // kill
  process.on('SIGUSR2', gracefulShutdown); // nodemon restart etc.

  process.on('uncaughtException', (err: Error) => {
    console.error('Uncaught Exception:', err);
    gracefulShutdown();
  });

  console.log('Log watcher configured with @logdna/tail-file (watching file: ' + logFilePath + '). Press Ctrl+C to exit.');

  // Keep the process alive (TailFile itself should keep it alive while watching)
  // process.stdin.resume(); // May not be needed if TailFile keeps the event loop active.
  // If the script exits prematurely, uncomment this.
}
