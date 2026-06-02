import { describe, it, expect } from 'vitest';
import { buildSimpleWaypoint } from './index';

describe('buildSimpleWaypoint', () => {
  it('creates a waypoint with display and audio presentations', () => {
    const wp = buildSimpleWaypoint(
      'wp-1',
      'disambiguate',
      'Select the correct file',
      'Which file did you mean?',
      [{ id: 'f1', label: 'main.ts' }, { id: 'f2', label: 'utils.ts' }],
      (id) => `open.${id}`,
    );
    expect(wp.id).toBe('wp-1');
    expect(wp.context.state).toBe('disambiguate');
    expect(wp.presentations.display?.prompt).toBe('Which file did you mean?');
    expect(wp.presentations.display?.options).toHaveLength(2);
    expect(wp.presentations.audio?.tts).toContain('main.ts');
    expect(wp.expectedInputs.voice?.intents).toHaveLength(2);
    expect(wp.expectedInputs.touch?.events).toHaveLength(2);
    expect(wp.fallback.channels[0].channel).toBe('sms');
    expect(wp.fallback.onExhaustion).toBe('queue');
  });

  it('maps option ids to intent types', () => {
    const wp = buildSimpleWaypoint(
      'wp-2',
      'confirm',
      'Confirm action',
      'Are you sure?',
      [{ id: 'yes', label: 'Yes' }],
      () => 'action.confirm',
    );
    expect(wp.expectedInputs.voice?.intents?.[0].intentType).toBe('action.confirm');
  });
});
