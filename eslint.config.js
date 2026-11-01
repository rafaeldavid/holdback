import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'docs/research/**', '.worktrees/**', '.claude/worktrees/**', 'tools/sim/runs/**'] },
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
    // ADR-0022: rates are integers (basis points, fractions, hundredths), so core source and the
    // judgment aggregation have no fractional literals. Tests are exempt: they write fractional values
    // to prove the parsers refuse them. The money block below replaces this list for money code.
    // Proven by money/lint.test.ts. It does not catch a fraction written as a string ("0.5" passed to
    // a parser) or division that produces a float at run time; integer math and the schemas cover those.
    files: ['packages/core/src/**/*.ts', 'packages/judgment/src/aggregate.ts'],
    ignores: ['packages/core/src/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[raw=/^(\\d[\\d_]*)?\\.\\d|^\\d[\\d_]*\\.$|^\\d[\\d_]*(\\.\\d*)?[eE]/]',
          message: 'Core must not use fractional or exponent numeric literals. Use basis points, fractions or bigint.',
        },
      ],
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
