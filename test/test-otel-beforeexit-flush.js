'use strict';

const path = require('node:path');
const assert = require('node:assert');
const { describe, it } = require('node:test');
const {
  startOTelCollector,
  getSpans,
  spawnPromisified,
} = require('./common/otel');

// Test that buffered spans are flushed via the beforeExit handler when the
// process exits while tracing is active. Tracing is activated in the child
// through the public init() API.

describe('otel beforeExit flush', () => {
  it('flushes buffered spans on process beforeExit', async () => {
    const collector = await startOTelCollector();

    // Spawn a child with tracing activated via init(). The child makes a
    // request and exits without any explicit shutdown. The beforeExit
    // handler should flush the buffered spans.
    const script = `
const http = require("http");
const otel = require(process.env.MICROTEL_PATH);
otel.init({ endpoint: ${JSON.stringify(`http://127.0.0.1:${collector.port}`)} });
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("ok");
});
server.listen(0, () => {
  const port = server.address().port;
  http.get("http://127.0.0.1:" + port + "/test", (res) => {
    res.resume();
    res.on("end", () => {
      server.close(() => http.globalAgent.destroy());
    });
  });
});
`;

    const { code } = await spawnPromisified(
      process.execPath,
      ['-e', script],
      {
        env: {
          ...process.env,
          MICROTEL_PATH: path.join(__dirname, '..'),
        },
      },
    );

    assert.strictEqual(code, 0);

    const spans = getSpans(await collector.next());

    await collector.close();

    assert.ok(spans.length > 0, 'Expected spans to be flushed on beforeExit');
  });
});
