'use strict';

// The http and http2 diagnostics channels publish headers after they are
// parsed, so a `.headers` object is always present by the time any handler
// runs. Optional chaining on it is dead code and hides real mistakes.
const banOptionalChainingOnHeaders = () => ({
  selector: "MemberExpression[optional=true][object.property.name='headers']",
  message:
    'Optional chaining on .headers is unnecessary: the diagnostics ' +
    'channels publish headers after parsing, so they are always an object.',
});

export default [
  {
    files: ['lib/**/*.js', 'test/**/*.js', 'benchmark/**/*.js', 'index.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': ['error', banOptionalChainingOnHeaders()],
    },
  },
  {
    ignores: ['node_modules/', 'test/fixtures/'],
  },
];
