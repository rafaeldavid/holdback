/**
 * The string without its trailing slashes: "https://api.example//" gives "https://api.example". It returns what
 * `s.replace(/\/+$/, '')` returns, in one pass from the end. That regex restarts at every slash of a run that
 * ends in another character, so its time grows with the square of the run's length (CodeQL js/polynomial-redos).
 */
export function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 0x2f) end--;
  return s.slice(0, end);
}
