'use strict';

// Measures the per-request overhead of the OpenTelemetry tracing subsystem
// on the http hot path. Requests are issued sequentially over a single
// keep-alive connection so that the difference between the traced and
// untraced configurations reflects per-request work (two spans per request:
// one SERVER, one CLIENT), not scheduling or connection noise.
//
// When tracing is enabled, spans are exported to an unreachable endpoint:
// the measurement covers span creation and serialization but not collector
// latency. Export failures are reported as throttled warnings.
//
// Run with: node benchmark/http.js [tracing=0|1] [n]

const tracing = Number(process.argv[2] ?? 0);
const n = Number(process.argv[3] ?? 1e5);

function main() {
  if (tracing) {
    const otel = require('..');
    otel.init({ endpoint: 'http://127.0.0.1:1' });
  }

  const http = require('http');

  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('ok');
  });

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

    let completed = 0;
    let measured = false;
    let startTime = 0;
    const kWarmup = 100;

    function request(done) {
      http.get({ host: '127.0.0.1', port, agent, path: '/bench' }, (res) => {
        res.resume();
        res.on('end', done);
      });
    }

    request(function done() {
      if (!measured) {
        completed++;
        if (completed < kWarmup) {
          request(done);
          return;
        }
        // Warmup is done; the measured requests start now.
        measured = true;
        completed = 0;
        startTime = process.hrtime.bigint();
      } else {
        completed++;
      }
      if (completed >= n) {
        const elapsedNs = Number(process.hrtime.bigint() - startTime);
        const nsPerRequest = (elapsedNs / n).toFixed(1);
        console.log(`otel_http/tracing=${tracing}/n=${n}: ` +
                    `${nsPerRequest} ns/request ` +
                    `(${(n / (elapsedNs / 1e9)).toFixed(0)} req/s)`);
        server.close();
        agent.destroy();
        return;
      }
      request(done);
    });
  });
}

main();
