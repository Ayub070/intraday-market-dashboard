import { createApp } from './app.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const app = createApp();

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
