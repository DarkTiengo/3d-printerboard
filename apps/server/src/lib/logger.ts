import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.logLevel,
  transport: config.isProd
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } }
});
