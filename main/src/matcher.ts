export function wildcardDomainMatch(domain: string, pattern: string) {
  // Escape regex special chars except for *
  const escaped = pattern.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
  // Replace * with .*
  const regexPattern = '^' + escaped.replace(/\*/g, '.*') + '$';
  const regex = new RegExp(regexPattern, 'i'); // 'i' for case-insensitive
  return regex.test(domain);
}

export function matchWithoutStars(domain: string, pattern: string) {
  const patternWithoutStars = pattern.replace(/\*/g, '').replace(/^\./, '');
  return domain == patternWithoutStars;
}
