// ISO 8601 calendar dates (YYYY-MM-DD) and RFC 3339 date-times, with calendar validation.
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/;

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= (m === 2 && leap(y) ? 29 : DAYS[m - 1]!);
}

export function isIso8601(s: string): boolean {
  if (s.length > 40) return false;
  const d = DATE.exec(s);
  if (d) return validDate(+d[1]!, +d[2]!, +d[3]!);
  const t = DATE_TIME.exec(s);
  if (!t) return false;
  const [hh, mm, ss] = [+t[4]!, +t[5]!, +t[6]!];
  if (hh > 23 || mm > 59 || ss > 59) return false;
  if (t[9] !== undefined && (+t[9] > 23 || +t[10]! > 59)) return false;
  return validDate(+t[1]!, +t[2]!, +t[3]!);
}
