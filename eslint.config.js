import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'docs/research/**'] },
  ...tseslint.configs.recommended,
  {
    // Hard rule: no code execution from inputs.
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // Hard rule: money is a string-backed amount in base units, never a float.
    // Money code uses TokenAmount (packages/core/src/money) and bigint. Proven by packages/core/src/money/lint.test.ts.
    files: ['packages/core/src/money/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'TSNumberKeyword', message: 'Money must not use number. Use TokenAmount and bigint.' },
        {
          selector: 'Literal[raw=/^(\\d[\\d_]*)?\\.\\d|^\\d[\\d_]*\\.$|^\\d[\\d_]*(\\.\\d*)?[eE]/]',
          message: 'Money must not use fractional or exponent numeric literals.',
        },
        { selector: 'CallExpression[callee.name=/^(Number|parseFloat|parseInt)$/]', message: 'Money must not convert to number.' },
        { selector: 'NewExpression[callee.name="Number"]', message: 'Money must not convert to number.' },
        { selector: 'MemberExpression[object.name=/^(Math|Number)$/]', message: 'Money must not use Math or Number helpers. Use bigint.' },
        { selector: 'MemberExpression[property.name=/^(toFixed|toPrecision)$/]', message: 'Money must not format floats.' },
        { selector: 'UnaryExpression[operator="+"]', message: 'Money must not coerce to number with unary +.' },
      ],
    },
  },
);
