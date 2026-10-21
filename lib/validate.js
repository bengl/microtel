'use strict';

// Ported from Node.js internal validators (lib/internal/validators.js) and
// errors (lib/internal/errors.js): only the small subset the tracing
// subsystem needs. Error shapes (name, code, message format) mirror the
// Node.js originals so behavior matches the core implementation.

function inspectValue(value) {
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'bigint') return `${value}n`;
  return String(value);
}

// The "${name}" argument must be of type ${types} ...
function invalidArgTypeError(name, types, value) {
  const err = new TypeError(
    `The "${name}" argument must be of type ${types.join(' or ')}. ` +
    `Received ${inspectValue(value)}`);
  err.code = 'ERR_INVALID_ARG_TYPE';
  return err;
}

// The value "${value}" is invalid for argument "${name}" ...
function invalidArgValueError(name, value, reason) {
  const err = new TypeError(
    `The value ${inspectValue(value)} is invalid for argument "${name}"` +
    (reason ? `: ${reason}` : ''));
  err.code = 'ERR_INVALID_ARG_VALUE';
  return err;
}

function validateString(value, name) {
  if (typeof value !== 'string') {
    throw invalidArgTypeError(name, ['string'], value);
  }
}

function validateObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidArgTypeError(name, ['Object'], value);
  }
}

function validateInteger(value, name, min) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalidArgTypeError(name, ['integer'], value);
  }
  if (min !== undefined && value < min) {
    const err = new RangeError(
      `The value of "${name}" is out of range. It must be >= ${min}. ` +
      `Received ${value}`);
    err.code = 'ERR_OUT_OF_RANGE';
    throw err;
  }
}

module.exports = {
  validateString,
  validateObject,
  validateInteger,
  invalidArgTypeError,
  invalidArgValueError,
};
