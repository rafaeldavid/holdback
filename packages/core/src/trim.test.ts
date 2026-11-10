import { describe, expect, it } from 'vitest';
import { trimTrailingSlashes } from './trim.js';

describe('trimTrailingSlashes', () => {
  it.each([
    ['', ''],
    ['///', ''],
    ['https://api.crow.direct', 'https://api.crow.direct'],
    ['https://api.crow.direct///', 'https://api.crow.direct'],
    ['a//b//', 'a//b'],
    ['a/\n', 'a/\n'],
  ])('trims %j to %j, as /\\/+$/ did', (input, want) => expect(trimTrailingSlashes(input)).toBe(want));
});
