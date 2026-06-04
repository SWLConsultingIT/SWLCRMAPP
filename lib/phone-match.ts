// Phone matching helpers shared by the Aircall webhook and the Aircall sync
// route. Lead phones arrive in every imaginable format — "+34 917 37 32 47",
// "(248) 296-7307", a leading "'" from a CSV/Excel text-forced cell, etc. The
// ONLY reliable comparison is "strip everything that isn't a digit, then check
// the trailing overlap". Country-code length differs (US +1 → 1 digit, ES +34
// → 2 digits), so we compare the last 9 digits (or the whole shorter number),
// which covers US/ES/IT/CO/AR national lengths.

export function phoneDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

export function phoneSuffixMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (da.length < 7 || db.length < 7) return false;
  const k = Math.min(da.length, db.length, 9);
  return da.slice(-k) === db.slice(-k);
}

// PostgREST can't strip non-digits in a filter, so a plain `ilike.*<digits>*`
// NEVER matches a phone stored with spaces in its trailing group — e.g. the
// last 4 digits of "...37 32 47" are "3247", but that substring doesn't exist
// because of the space between "32" and "47". Build a pattern that places a
// wildcard BETWEEN every digit of the trailing suffix so any spacing/format
// survives: "3247" → "%3%2%4%7%". Using the last 7 digits keeps the candidate
// set small (7 specific digits, in order) while tolerating arbitrary spacing;
// callers still finalize with phoneSuffixMatch in JS to drop loose matches.
export function ilikeDigitPattern(raw: string | null | undefined, tailLen = 7): string | null {
  const digits = phoneDigits(raw);
  if (digits.length < 4) return null;
  const tail = digits.slice(-Math.min(tailLen, digits.length));
  return "*" + tail.split("").join("*") + "*";
}
