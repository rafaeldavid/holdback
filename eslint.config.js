import tseslint from 'typescript-eslint';

/** The state reads T-232's rule requires a block for (viem's public actions). */
const READS = 'readContract|estimateGas|estimateContractGas|simulateContract|call|getBalance|getTransactionCount|getStorageAt|multicall';

/**
 * T-232, local rules with no new dependency. `disable-with-reason`: an eslint-disable comment that could silence the
 * read rule (one that names no rule, or names no-restricted-syntax) names its rules and says why after `--`; core ESLint
 * cannot require that. It reports at the file's first character, before any disable comment can cover the report, so a
 * file-level `/* eslint-disable *\/` that does not start the file does not hide it either. Ported from T-232's review
 * round by T-409.
 */
const holdback = {
  rules: {
    'disable-with-reason': {
      meta: { type: 'problem', schema: [], messages: { bare: 'A disable comment in live-chain code names its rules and says why after "--" (T-232): {{comment}}' } },
      create(context) {
        return {
          Program() {
            for (const c of context.sourceCode.getAllComments()) {
              const m = /^\s*eslint-disable(?:-next-line|-line)?(?:\s+([\s\S]*))?$/.exec(c.value);
              if (!m) continue;
              const [rules = '', reason = ''] = (m[1] ?? '').split(/\s-{2,}\s/);
              const names = rules.split(',').map((r) => r.trim()).filter(Boolean);
              if (names.length > 0 && !names.includes('no-restricted-syntax')) continue;
              if (names.length > 0 && reason.trim()) continue;
              context.report({ loc: { line: 1, column: 0 }, messageId: 'bare', data: { comment: c.value.trim().slice(0, 80) } });
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'docs/research/**', '.worktrees/**', '.claude/worktrees/**', 'tools/sim/runs/**', 'apps/demo-cloud/.wrangler/**', 'apps/demo-cloud/reports/**', 'reports/**','apps/demo-cloud/worker/generated-files.js', 'packages/core/src/validators.generated.ts','site/try.mjs', 'site/buy.mjs', 'contracts/lib/**', 'contracts/out/**', 'contracts/cache/**'] },
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
  {
    // docs/team.md, "A chain read after a transaction sees that transaction" (T-232): every read of a live chain's state
    // names its block. A load-balanced RPC answers a read that names none from a node a block or more behind, which still
    // shows the state before this node's own last write (five times on Sepolia, 2026-11-04 to 2026-11-06). Pin it with
    // `chain.pinned` (the node's latest block, never before the chain's floor), or pass the receipt's block. A read that
    // cannot name one says why on an eslint-disable line. Anvil's world (world.ts) is one node and is exempt, as are tests.
    // Proven by tests/read-after-write.lint.test.ts and tests/read-after-write.lint-bypass.test.ts, which also lists what
    // the rule cannot see (it matches calls on objects named publicClient or client, by syntax, not by type).
    files: ['packages/settlement/evm/**/*.{ts,mts,cts}', 'apps/*/src/**/*.{ts,mts,cts}'],
    ignores: ['**/*.test.{ts,mts,cts}', 'packages/settlement/evm/world.ts', 'packages/settlement/evm/testing.ts'],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { holdback },
    rules: {
      'holdback/disable-with-reason': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // The call names `blockNumber` itself, in its own argument object, and not as `undefined`: a nested one (in
          // `args`), one inside a spread, or `blockTag: 'latest'` alone does not count. (esquery reads a missing
          // attribute as the string "undefined", hence the Identifier test beside the name.)
          selector: `CallExpression:matches([callee.property.name=/^(${READS})$/], [callee.property.value=/^(${READS})$/]):matches([callee.object.property.name=/^(publicClient|client)$/], [callee.object.name=/^(publicClient|client)$/]):not(:has(> ObjectExpression:has(> Property[key.name="blockNumber"]:not([value.type="Identifier"][value.name="undefined"]))))`,
          message: 'A chain read names its block (T-232): pass blockNumber from chain.pinned or the receipt, or say why on an eslint-disable line.',
        },
        {
          selector: `VariableDeclarator:matches([init.property.name=/^(publicClient|${READS})$/], [init.name=/^(publicClient|client)$/])`,
          message: 'Read the chain through chain.publicClient itself, not an alias or an extracted method, so the read rule sees each read (T-232).',
        },
        {
          selector: 'ImportDeclaration[source.value="viem/actions"]',
          message: "viem's standalone actions take the client as an argument, past the read rule: call them on chain.publicClient (T-232).",
        },
        {
          selector: 'CallExpression[callee.property.name="request"]:has(Property[key.name="method"][value.value=/^eth_(call|estimateGas|getBalance|getTransactionCount|getStorageAt|getCode|getProof)$/])',
          message: "A raw JSON-RPC state read goes past the read rule: use viem's action with blockNumber (T-232).",
        },
      ],
    },
  },
);
