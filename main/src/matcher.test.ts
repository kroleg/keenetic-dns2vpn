import { describe, it, expect } from 'vitest';
import { matchWithoutStars, wildcardDomainMatch } from './matcher';

describe('wildcardDomainMatch', () => {
  it('should return true for sub.example.com and *.example.com', () => {
    expect(wildcardDomainMatch('sub.example.com', '*.example.com')).toBe(true);
  });

  it('should return true for deep.sub.example.com and *.example.com', () => {
    expect(wildcardDomainMatch('deep.sub.example.com', '*.example.com')).toBe(true);
  });

  it('should return true for example123.com and example*.com', () => {
    expect(wildcardDomainMatch('example123.com', 'example*.com')).toBe(true);
  });

  it('should return true for anything starting with provided', () => {
    expect(wildcardDomainMatch('example123.com.com', 'example*')).toBe(true);
  });

  it('should return true for foo.bar.com and *.bar.com', () => {
    expect(wildcardDomainMatch('foo.bar.com', '*.bar.com')).toBe(true);
  });

  it('should return false for bar.com and *.bar.com', () => {
    expect(wildcardDomainMatch('bar.com', '*.bar.com')).toBe(false);
  });
});

describe(matchWithoutStars, () => {
  it('should remove stars and leading dot and return true if exact match', () => {
    expect(matchWithoutStars('example.com', '*.example.com')).toBe(true);
  });

  it('should remove stars and leading dot and return false if not exact match', () => {
    expect(matchWithoutStars('sexample.com', '*.example.com')).toBe(false);
  });
});
