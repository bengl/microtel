'use strict';

// @nodejs/microtel: OpenTelemetry tracing for Node.js core protocols.
//
// The public surface is deliberately minimal: init() activates tracing,
// isActive() reports whether it is active, and flush() forces an export
// of buffered spans. Tracing is activated at most once per process and
// cannot be stopped again.

const { start, isActive } = require('./lib/core');
const { flush } = require('./lib/flush');

module.exports = {
  init: start,
  isActive,
  flush,
};
