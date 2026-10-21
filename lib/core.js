'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const {
  invalidArgTypeError,
  invalidArgValueError,
  validateInteger,
  validateObject,
  validateString,
} = require('./validate');

const kDefaultEndpoint = 'http://localhost:4318';
// The default follows the OpenTelemetry semantic conventions: a
// low-cardinality fallback value, deliberately without the pid.
const kDefaultServiceName = 'unknown_service:node';

let endpoint = null;
let active = false;
let filter = null; // null = all modules enabled; Set = only listed modules.
let spanStorage = null;
let collectorHost = null; // Normalized host (e.g. "localhost:4318") for HTTP client filtering.
let serviceName = kDefaultServiceName;

function getSpanStorage() {
  spanStorage ??= new AsyncLocalStorage();
  return spanStorage;
}

function isActive() {
  return active;
}

function getEndpoint() {
  return endpoint;
}

function getCollectorHost() {
  return collectorHost;
}

function getServiceName() {
  return serviceName;
}

function isModuleEnabled(moduleName) {
  if (filter == null) return true;
  return filter.has(moduleName);
}

function parseFilter(filter) {
  if (filter == null) return null;
  if (typeof filter === 'string') {
    const parts = filter.split(',');
    const set = new Set();
    for (let i = 0; i < parts.length; i++) {
      const trimmed = parts[i].trim();
      if (trimmed) set.add(trimmed);
    }
    return set;
  }
  throw invalidArgTypeError('options.filter', ['string', 'null', 'undefined'],
                            filter);
}

function start(options = { __proto__: null }) {
  // Tracing is activated at most once per process. There is no way to stop
  // it again: disabling the flusher and instrumentations is not supported.
  if (active) return;

  validateObject(options, 'options');

  const endpointValue = options.endpoint ?? kDefaultEndpoint;
  validateString(endpointValue, 'options.endpoint');
  if (!endpointValue) {
    throw invalidArgValueError('options.endpoint', endpointValue,
                               'must be a non-empty string');
  }

  let parsed;
  try {
    parsed = new URL(endpointValue);
  } catch {
    throw invalidArgValueError('options.endpoint', endpointValue,
                               'must be a valid URL');
  }

  // The exporter only speaks OTLP/HTTP. Rejecting unsupported protocols
  // here matters because activation cannot be undone: a protocol typo
  // would otherwise permanently disable tracing for the process.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalidArgValueError('options.endpoint', endpointValue,
                               'only http: and https: endpoints are supported');
  }

  if (options.maxBufferSize !== undefined) {
    validateInteger(options.maxBufferSize, 'options.maxBufferSize', 1);
  }
  if (options.flushInterval !== undefined) {
    validateInteger(options.flushInterval, 'options.flushInterval', 1);
  }

  const parsedFilter = parseFilter(options.filter);

  if (options.serviceName !== undefined) {
    validateString(options.serviceName, 'options.serviceName');
    if (!options.serviceName) {
      throw invalidArgValueError('options.serviceName', options.serviceName,
                                 'must be a non-empty string');
    }
  }

  endpoint = endpointValue;
  filter = parsedFilter;
  active = true;
  collectorHost = parsed.host;
  serviceName = options.serviceName ?? kDefaultServiceName;

  const { enableInstrumentations } = require('./instrumentations');
  enableInstrumentations();

  const { startFlusher } = require('./flush');
  startFlusher(options);
}

module.exports = {
  start,
  isActive,
  getEndpoint,
  getSpanStorage,
  isModuleEnabled,
  getCollectorHost,
  getServiceName,
};
