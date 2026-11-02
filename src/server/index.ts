import { createApp } from './app';
import { Services } from './services';
import { loadEnv } from './env';

const env = loadEnv();
const services = new Services({ startScheduler: true });
const app = createApp(services);

const server = app.listen(env.port, env.host, () => {
  console.log(`PCO Prime Sync server listening on http://${env.host}:${env.port}`);
  console.log(`Database: ${env.databasePath}`);
  console.log(
    env.pcoAppId && env.pcoSecretSource !== 'missing'
      ? `Planning Center: configured (secret from ${env.pcoSecretSource})`
      : 'Planning Center: NOT configured — add PCO_APP_ID and PCO_SECRET to .env',
  );
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down`);
  server.close(() => {
    void services.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
