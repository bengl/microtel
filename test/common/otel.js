'use strict';

const http = require('node:http');
const { spawn } = require('node:child_process');

// Helpers for tests of the OpenTelemetry tracing subsystem. They require no
// internals: tracing is either activated directly in-process through
// require('../lib/core') (or the public API), or in a child process via
// require(process.env.MICROTEL_PATH).init({...}).

// Starts a local HTTP server that acts as an OTLP/HTTP JSON collector.
//
// Resolves with an object providing:
//   * port:     the port the collector listens on
//   * next():   a promise that resolves with the next OTLP payload received,
//               whether it arrives before or after next() is called
//   * payloads: an array of every OTLP payload received so far
//   * requests: an array of { url, headers } for each export request
//   * close():  a promise that resolves once the collector has closed
async function startOTelCollector() {
  const requests = [];
  const payloads = [];
  const queue = [];
  let signal;
  let signalPromise = new Promise((resolve) => { signal = resolve; });

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, headers: req.headers });
      const payload = JSON.parse(body);
      payloads.push(payload);
      queue.push(payload);
      res.writeHead(200);
      res.end();
      signal();
      signalPromise = new Promise((resolve) => { signal = resolve; });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    port: server.address().port,
    async next() {
      while (queue.length === 0) {
        await signalPromise;
      }
      return queue.shift();
    },
    payloads,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Starts a plain HTTP server for tests to make traced requests against.
// The default handler responds with 200 OK.
//
// Resolves with an object providing:
//   * port:    the port the server listens on
//   * close(): a promise that resolves once the server has closed
async function startHTTPServer(
  handler = (req, res) => {
    res.writeHead(200);
    res.end('ok');
  },
) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Extracts the spans array from an OTLP/HTTP JSON export payload.
function getSpans(payload) {
  return payload.resourceSpans[0].scopeSpans[0].spans;
}

// Makes one traced GET request against the given server and waits for the
// response to finish.
function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      res.resume();
      res.on('end', resolve);
    }).on('error', reject);
  });
}

// Decodes a span's OTLP attributes into a plain key/value object.
function spanAttrs(span) {
  const attrs = {};
  for (const a of span.attributes ?? []) {
    attrs[a.key] =
      a.value.stringValue || a.value.intValue || a.value.doubleValue;
  }
  return attrs;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Spawns a process and resolves with { code, stdout, stderr } once it
// exits. If options.timeout is given and exceeded, the child is killed and
// the promise resolves with code null.
function spawnPromisified(execPath, args, options = {}) {
  const { timeout, ...spawnOptions } = options;
  const child = spawn(execPath, args, {
    stdio: 'pipe',
    ...spawnOptions,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  let timedOut = false;
  let timer;
  if (timeout != null) {
    timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
  }

  return new Promise((resolve) => {
    child.on('exit', (code) => {
      if (timedOut) code = null;
      if (timer != null) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

module.exports = {
  startOTelCollector,
  startHTTPServer,
  getSpans,
  httpGet,
  spanAttrs,
  delay,
  spawnPromisified,
};
