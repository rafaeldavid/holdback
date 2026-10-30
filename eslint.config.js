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
    // Stub until T-004 adds the branded TokenAmount type and a real rule.
    files: ['packages/core/src/money/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'TSNumberKeyword', message: 'Money must not use number. Use the TokenAmount type.' },
        { selector: 'Literal[raw=/^\\d*\\.\\d+$/]', message: 'Money must not use fractional numeric literals.' },
      ],
    },
  },
);
