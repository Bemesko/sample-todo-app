import { createApp } from './app.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number.parseInt(process.env.PORT ?? '3001', 10);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT must be an integer between 0 and 65535');
}

const staticDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../client/dist'
);
const app = createApp({ staticDir });

app.listen(port, () => {
  const address = app.address();
  const listeningPort =
    typeof address === 'object' && address !== null ? address.port : port;
  console.log(`API listening on http://localhost:${listeningPort}`);
});
