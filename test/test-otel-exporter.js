'use strict';

const path = require('node:path');
const assert = require('node:assert');
const http = require('node:http');
const { describe, it } = require('node:test');
const { spawnPromisified } = require('./common/otel');

// This test verifies exporter error handling and process lifecycle behavior.
// Tracing is activated in the child processes through the public init() API.

const MICROTEL_PATH = path.join(__dirname, '..');

describe('otel exporter behavior', () => {
  it('does not crash when collector is unreachable', async () => {
    const { code, stdout } = await spawnPromisified(process.execPath, [
      '-e',
      `
      const otel = require(process.env.MICROTEL_PATH);
      otel.init({ endpoint: 'http://127.0.0.1:1' });
      const http = require('node:http');

      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('ok');
      });

      server.listen(0, () => {
        http.get('http://127.0.0.1:' + server.address().port, (res) => {
          res.resume();
          res.on('end', () => {
            server.close(() => {
              http.globalAgent.destroy();
              console.log('success');
            });
          });
        });
      });
      `,
    ], {
      env: {
        ...process.env,
        MICROTEL_PATH,
      },
    });

    assert.strictEqual(code, 0);
    assert.match(stdout, /success/);
  });

  it('gives up on an unresponsive collector and still exits', async () => {
    // A collector that accepts the connection but never responds. The
    // exporter request must time out, and the child must still exit.
    const collector = http.createServer(() => {});
    await new Promise((resolve) => collector.listen(0, '127.0.0.1', resolve));

    try {
      const { code, stderr } = await spawnPromisified(
        process.execPath,
        [
          '-e',
          `
          const otel = require(process.env.MICROTEL_PATH);
          otel.init({ endpoint: ${JSON.stringify(`http://127.0.0.1:${collector.address().port}`)} });
          const http = require('node:http');
          http.get('http://127.0.0.1:1/', () => {}).on('error', () => {});
          `,
        ],
        {
          env: {
            ...process.env,
            MICROTEL_PATH,
          },
          timeout: 30_000,
        },
      );

      assert.strictEqual(code, 0);
      assert.match(stderr, /OTelExportWarning/);
    } finally {
      collector.close();
    }
  });

  it('flush timer does not keep process alive', async () => {
    const { code, stdout } = await spawnPromisified(process.execPath, [
      '-e',
      `
      const otel = require(process.env.MICROTEL_PATH);
      otel.init({ endpoint: 'http://127.0.0.1:1' });
      console.log('exiting');
      `,
    ], {
      env: {
        ...process.env,
        MICROTEL_PATH,
      },
      timeout: 10_000,
    });

    assert.strictEqual(code, 0);
    assert.match(stdout, /exiting/);
  });
});
