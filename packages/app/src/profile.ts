/** First and last name initials, keeping non-Latin letters and combining marks. */
export function initialsForName(name: string): string {
  const parts = name.normalize('NFC').trim().split(/\s+/u).filter(part => /[\p{L}\p{N}]/u.test(part));
  const initial = (part: string) => part.toUpperCase().match(/[\p{L}\p{N}]\p{M}*/u)?.[0] ?? '';
  if (!parts.length) return '–';
  return initial(parts[0]) + (parts.length > 1 ? initial(parts[parts.length - 1]) : '');
}
