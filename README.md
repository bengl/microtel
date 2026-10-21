# @nodejs/microtel

Node.js experimental OpenTelemetry built-in support.

> This module is under active development and is not yet ready for use.

This project aims to be an independent implementation of _parts_ of OpenTelemetry. It is focused on supporting the [traces])(https://opentelemetry.io/docs/concepts/signals/traces/) signal alongside tracing context propagation.
It's intended to be included in Node.js core as a dependency, and wired up in there accordingly.
It seeks to enable:

* Instrumentation of inbound and outbound HTTP transactions, following [OTel Semconv](https://opentelemetry.io/docs/specs/semconv/general/trace/).
* Tracing data egress via OTLP/JSON. (JSON-only to avoid bringing in a gRPC dependency.)
* Distributed tracing via W3C Traceparent, including forwarding baggage (but not modifying it).

Anything else, including the following, should be considered initally out of scope:

* Any sort of programmatic API in Node.js core
* Creation of spans other than the built-in ones
* Metrics via OTLP
* Logs via OTLP
* Publishing to npm (it's only intended as a dependency of Node.js for now, but this could change in the future, maybe)

## License

[MIT](./LICENSE)
