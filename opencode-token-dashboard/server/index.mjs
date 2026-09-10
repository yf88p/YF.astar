import { pathToFileURL } from 'node:url';
import { createDashboardServer } from './http.mjs';

export function parseOptions(args = process.argv.slice(2), env = process.env) {
  let port = env.PORT ?? '3000';
  let dev = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--dev') dev = true;
    else if (arg === '--port') port = args[++index];
    else if (arg.startsWith('--port=')) port = arg.slice('--port='.length);
    else throw new Error('Supported arguments: --dev and --port <1-65535>.');
  }
  if (typeof port !== 'string' || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('PORT/--port must be an integer from 1 to 65535.');
  }
  return { port: Number(port), dev };
}

async function main() {
  let options;
  try {
    options = parseOptions();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const server = await createDashboardServer({ dev: options.dev });
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? 'Port is already in use. Set PORT or pass --port to select another port.' : 'Unable to start the loopback dashboard server.');
    server.close();
    process.exitCode = 1;
  });
  server.listen(options.port, '127.0.0.1', () => {
    console.log(`OpenCode token dashboard: http://127.0.0.1:${options.port}${options.dev ? ' (development)' : ''}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close();
      server.closeAllConnections();
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Unable to initialize the dashboard. For --dev, install the frontend dependencies including Vite.');
    process.exitCode = 1;
  });
}
