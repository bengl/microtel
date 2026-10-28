'use strict';

const { registerFetchBenchmark } = require('./helpers/http');

registerFetchBenchmark('fetch request (traced)', { tracing: true });
