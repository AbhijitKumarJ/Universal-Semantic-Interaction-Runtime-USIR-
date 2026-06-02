import { describe, it, expect } from 'vitest';
import { parseDomResult } from './dom-extractor';

describe('parseDomResult', () => {
  it('parses valid extract result', () => {
    const r = parseDomResult({
      extractViewport: [{ id: 'dom://button[1]', role: 'ui_region' }],
      extractFull: [{ id: 'dom://div[1]', role: 'unknown' }],
    });
    expect(r.extractViewport).toHaveLength(1);
    expect(r.extractFull).toHaveLength(1);
    expect(r.extractViewport[0].id).toBe('dom://button[1]');
  });

  it('handles missing or invalid data', () => {
    expect(parseDomResult(null).extractViewport).toEqual([]);
    expect(parseDomResult(undefined).extractFull).toEqual([]);
    expect(parseDomResult({}).extractViewport).toEqual([]);
    expect(parseDomResult({ extractViewport: 'not-array' }).extractViewport).toEqual([]);
  });
});
