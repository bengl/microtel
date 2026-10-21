'use strict';

const path = require('node:path');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { describe, it } = require('node:test');
const {
  startOTelCollector,
  getSpans,
  spawnPromisified,
} = require('./common/otel');

// Tracing is activated through the public init() API. Tracing can only be
// activated once per process, so the positive activation tests run in
// child processes (each with a fresh process), while the validation tests
// run in-process (they throw before any state is mutated and thus do not
// consume the single activation).

const MICROTEL_PATH = path.join(__dirname, '..');

// Spawns a child with access to the package via MICROTEL_PATH.
function spawnMicrotel(script, env = {}, options = {}) {
  return spawnPromisified(
    process.execPath,
    ['-e', script],
    {
      env: { ...process.env, MICROTEL_PATH, ...env },
      ...options,
    },
  );
}

// Runs a child that activates tracing, makes one traced HTTP request, and
// flushes explicitly. Resolves once the child has exited.
function tracedChildScript() {
  return `
  const http = require('node:http');
  const otel = require(process.env.MICROTEL_PATH);
  const opts = { endpoint: process.env.OTEL_ENDPOINT };
  if (process.env.OTEL_SERVICE_NAME) {
    opts.serviceName = process.env.OTEL_SERVICE_NAME;
  }
  otel.init(opts);
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  server.listen(0, '127.0.0.1', () => {
    http.get('http://127.0.0.1:' + server.address().port + '/svc', (res) => {
      res.resume();
      res.on('end', () => {
        otel.flush();
        server.close(() => {
          http.globalAgent.destroy();
          console.log('done');
        });
      });
    });
  });
  `;
}

describe('otel init validation', () => {
  const otel = require('..');

  it('throws on an invalid endpoint', () => {
    assert.throws(() => {
      otel.init({ endpoint: 'not-a-valid-url' });
    }, { code: 'ERR_INVALID_ARG_VALUE' });
  });

  it('throws on an empty endpoint', () => {
    assert.throws(() => {
      otel.init({ endpoint: '' });
    }, { code: 'ERR_INVALID_ARG_VALUE' });
  });

  it('throws on an invalid maxBufferSize', () => {
    assert.throws(() => {
      otel.init({ endpoint: 'http://127.0.0.1:1', maxBufferSize: 0 });
    }, { name: 'RangeError', code: 'ERR_OUT_OF_RANGE' });
    assert.throws(() => {
      otel.init({ endpoint: 'http://127.0.0.1:1', maxBufferSize: 'abc' });
    }, { code: 'ERR_INVALID_ARG_TYPE' });
  });

  it('throws on an invalid flushInterval', () => {
    assert.throws(() => {
      otel.init({ endpoint: 'http://127.0.0.1:1', flushInterval: 0 });
    }, { name: 'RangeError', code: 'ERR_OUT_OF_RANGE' });
    assert.throws(() => {
      otel.init({ endpoint: 'http://127.0.0.1:1', flushInterval: 'abc' });
    }, { code: 'ERR_INVALID_ARG_TYPE' });
  });

  it('throws on an unsupported endpoint protocol', () => {
    assert.throws(() => {
      otel.init({ endpoint: 'ftp://collector.example.com' });
    }, { code: 'ERR_INVALID_ARG_VALUE' });
    // Validation happens before any state is mutated, so tracing stays
    // inactive and a corrected init() would still work.
    assert.strictEqual(otel.isActive(), false);
  });

  it('throws on an invalid filter type', () => {
    assert.throws(() => {
      otel.init({ endpoint: 'http://127.0.0.1:1', filter: 42 });
    }, { code: 'ERR_INVALID_ARG_TYPE' });
  });

  it('throws on an empty serviceName', () => {
    assert.throws(() => {
      otel.init({ endpoint: 'http://127.0.0.1:1', serviceName: '' });
    }, { code: 'ERR_INVALID_ARG_VALUE' });
  });
});

describe('otel init activation', () => {
  it('activates tracing with the default endpoint', async () => {
    const { code, stdout } = await spawnMicrotel(`
    const otel = require(process.env.MICROTEL_PATH);
    const { getEndpoint } = require(process.env.MICROTEL_PATH + '/lib/core');
    otel.init();
    console.log('active:' + otel.isActive());
    console.log('endpoint:' + getEndpoint());
    `);

    assert.strictEqual(code, 0);
    assert.match(stdout, /active:true/);
    assert.match(stdout, /endpoint:http:\/\/localhost:4318/);
  });

  it('accepts maxBufferSize and flushInterval', async () => {
    const { code, stdout } = await spawnMicrotel(`
    const otel = require(process.env.MICROTEL_PATH);
    otel.init({
      endpoint: 'http://127.0.0.1:9999',
      maxBufferSize: 250,
      flushInterval: 2500,
    });
    console.log('active:' + otel.isActive());
    `);

    assert.strictEqual(code, 0);
    assert.match(stdout, /active:true/);
  });

  it('filter accepts node:fetch as an alias for undici', async () => {
    const { code, stdout } = await spawnMicrotel(`
    const otel = require(process.env.MICROTEL_PATH);
    const { isModuleEnabled } =
      require(process.env.MICROTEL_PATH + '/lib/core');
    otel.init({ endpoint: 'http://127.0.0.1:1', filter: 'node:fetch' });
    console.log('fetch:' + isModuleEnabled('node:fetch'));
    console.log('http:' + isModuleEnabled('node:http'));
    `);

    assert.strictEqual(code, 0);
    const lines = stdout.trim().split('\n');
    assert.match(lines.find((l) => l.startsWith('fetch:')), /fetch:true/);
    assert.match(lines.find((l) => l.startsWith('http:')), /http:false/);
  });

  it('filter limits instrumented modules', async () => {
    const { code, stdout } = await spawnMicrotel(`
    const otel = require(process.env.MICROTEL_PATH);
    const { isModuleEnabled } =
      require(process.env.MICROTEL_PATH + '/lib/core');
    otel.init({
      endpoint: 'http://127.0.0.1:1',
      filter: 'node:http,node:net',
    });
    console.log('http:' + isModuleEnabled('node:http'));
    console.log('net:' + isModuleEnabled('node:net'));
    console.log('dns:' + isModuleEnabled('node:dns'));
    `);

    assert.strictEqual(code, 0);
    const lines = stdout.trim().split('\n');
    assert.match(lines.find((l) => l.startsWith('http:')), /http:true/);
    assert.match(lines.find((l) => l.startsWith('net:')), /net:true/);
    assert.match(lines.find((l) => l.startsWith('dns:')), /dns:false/);
  });

  it('a second init() is a silent no-op', async () => {
    const { code, stdout, stderr } = await spawnMicrotel(`
    const otel = require(process.env.MICROTEL_PATH);
    const { getEndpoint } = require(process.env.MICROTEL_PATH + '/lib/core');
    otel.init({ endpoint: 'http://127.0.0.1:9999' });
    otel.init({ endpoint: 'http://127.0.0.1:1' });
    console.log('active:' + otel.isActive());
    console.log('endpoint:' + getEndpoint());
    `);

    assert.strictEqual(code, 0);
    assert.strictEqual(stderr, '');
    assert.match(stdout, /active:true/);
    assert.match(stdout, /endpoint:http:\/\/127\.0\.0\.1:9999/);
  });

  it('exports the default service name in resource attributes', async () => {
    const collector = await startOTelCollector();

    const { code, stdout } = await spawnMicrotel(tracedChildScript(), {
      OTEL_ENDPOINT: `http://127.0.0.1:${collector.port}`,
    });

    assert.strictEqual(code, 0);
    assert.match(stdout, /done/);

    const payload = await collector.next();
    await collector.close();

    const resource = payload.resourceSpans[0].resource;
    const serviceNameAttr = resource.attributes.find(
      (a) => a.key === 'service.name');
    assert.ok(serviceNameAttr, 'Expected a service.name resource attribute');
    assert.strictEqual(serviceNameAttr.value.stringValue,
                       'unknown_service:node');
  });

  it('exports a custom service name in resource attributes', async () => {
    const collector = await startOTelCollector();

    const { code, stdout } = await spawnMicrotel(tracedChildScript(), {
      OTEL_ENDPOINT: `http://127.0.0.1:${collector.port}`,
      OTEL_SERVICE_NAME: 'my-service',
    });

    assert.strictEqual(code, 0);
    assert.match(stdout, /done/);

    const payload = await collector.next();
    await collector.close();

    const resource = payload.resourceSpans[0].resource;
    const serviceNameAttr = resource.attributes.find(
      (a) => a.key === 'service.name');
    assert.ok(serviceNameAttr, 'Expected a service.name resource attribute');
    assert.strictEqual(serviceNameAttr.value.stringValue, 'my-service');

    const spans = getSpans(payload);
    assert.ok(spans.length > 0, 'Expected at least one span');
  });

  it('flushes when the buffer fills, without waiting for exit', async () => {
    const collector = await startOTelCollector();

    // The child traces its own requests. Each request produces a server
    // and a client span, so a buffer size of 10 flushes long before the
    // child exits (it never exits on its own; the parent kills it).
    const script = `
    const http = require('node:http');
    const otel = require(process.env.MICROTEL_PATH);
    otel.init({
      endpoint: ${JSON.stringify(`http://127.0.0.1:${collector.port}`)},
      maxBufferSize: 10,
    });
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      let remaining = 12;
      function next() {
        if (remaining-- === 0) return;
        http.get('http://127.0.0.1:' + port + '/fill', () => next()).on('error', () => {});
      }
      next();
    });
    `;

    const child = spawn(process.execPath, ['-e', script], {
      stdio: 'pipe',
      env: { ...process.env, MICROTEL_PATH },
    });

    // The payload must arrive while the child is still alive; if the child
    // exits first, the flush only happened at exit and the test fails.
    const spans = await Promise.race([
      collector.next().then(getSpans),
      new Promise((_, reject) => {
        child.on('exit', () => reject(new Error('child exited before flush')));
      }),
    ]);

    child.kill();
    await collector.close();

    assert.ok(spans.length > 0, 'Expected spans flushed by the full buffer');
  });
});
