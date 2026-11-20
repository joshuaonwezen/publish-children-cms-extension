// Language names and dates in English (en-GB), like the rest of the panel's copy. Never the
// browser's language: on a Dutch Mac that put "Engels" and "Duits" into English sentences.
const NAMES = new Intl.DisplayNames(['en-GB'], {type: 'language'});

/** "Dutch" for nl; the code itself when it has no name. */
export function languageName(code: string): string {
  try {
    const name = NAMES.of(code);
    return name && name.toLowerCase() !== code.toLowerCase() ? name : code;
  } catch {
    // RangeError: not a well-formed language code.
    return code;
  }
}

/** "Dutch (nl)", "Japanese (Japan, ja-JP)": the name with the code the CMS shows. */
export function languageLabel(code: string): string {
  const name = languageName(code);
  if (name === code) return code;
  return name.endsWith(')') ? `${name.slice(0, -1)}, ${code})` : `${name} (${code})`;
}

/** "5 Nov", with the year when it isn't this year; '' when there is no date. */
export function shortDate(iso: string | null | undefined, now = new Date()): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear() === now.getFullYear() ? {} : {year: 'numeric' as const};
  return date.toLocaleDateString('en-GB', {day: 'numeric', month: 'short', ...year});
}
