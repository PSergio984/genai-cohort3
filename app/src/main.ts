// Composition root: the only place that binds a port. Not imported by tests.
import { createApp } from './server.js';

const port = Number(process.env.PORT ?? 8080);
createApp().listen(port, '0.0.0.0', () => {
  console.log(`grounded-journal listening on 0.0.0.0:${port}`);
});
