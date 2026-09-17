import express, { type Express, type Request, type Response } from 'express';

import {
  createYahooClient,
  type YahooClient,
} from './market-data/yahooClient.js';
import { createIntradayHandler } from './routes/intradayRoute.js';

export const HEALTH_RESPONSE = { status: 'ok' } as const;

export function getHealth(_request: Request, response: Response): void {
  response.status(200).json(HEALTH_RESPONSE);
}

export interface AppDependencies {
  readonly now?: () => Date;
  readonly yahooClient?: YahooClient;
}

export function createApp({
  now = () => new Date(),
  yahooClient = createYahooClient(),
}: AppDependencies = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  app.get('/health', getHealth);
  app.get(
    '/api/stocks/:symbol/intraday',
    createIntradayHandler({ now, yahooClient }),
  );

  return app;
}
