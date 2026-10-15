const { createApp } = require('./app');
const env = require('./config/env');

async function main() {
  const app = createApp();
  await app.locals.database.ping();
  const server = app.listen(env.port, () =>
    console.log(`Edgenroots Formula Engine listening on http://localhost:${env.port}`),
  );
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; shutting down gracefully.`);
    server.close(async () => {
      try {
        await app.locals.database.close();
        process.exitCode = 0;
      } catch (error) {
        console.error('Database close failed:', error);
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}
main().catch((error) => {
  console.error('Failed to start service:', error);
  process.exitCode = 1;
});
