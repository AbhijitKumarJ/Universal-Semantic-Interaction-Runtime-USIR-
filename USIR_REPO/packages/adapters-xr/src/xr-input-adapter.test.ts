import { describe, it, expect } from 'vitest';
import { XrInputAdapter } from './xr-input-adapter';

describe('XrInputAdapter', () => {
  it('returns hand tracking data', async () => {
    const adapter = new XrInputAdapter();
    const hands = await adapter.getHandTracking();
    expect(hands).toHaveLength(2);
    expect(hands[0].handedness).toBe('left');
    expect(hands[1].handedness).toBe('right');
    expect(hands[0].gestures).toContain('open');
    expect(hands[1].gestures).toContain('point');
    expect(hands[0].fingers.length).toBeGreaterThan(0);
  });

  it('returns eye gaze data', async () => {
    const adapter = new XrInputAdapter();
    const gaze = await adapter.getEyeGaze();
    expect(gaze.origin).toBeDefined();
    expect(gaze.direction.z).toBe(-1);
    expect(gaze.timestamp).toBeGreaterThan(0);
  });

  it('polls and drains interaction events', async () => {
    const adapter = new XrInputAdapter();
    adapter.injectInteraction({
      type: 'select', source: 'hand', targetEntityId: 'cube-1',
      position: { x: 0, y: 0.5, z: -1 }, timestamp: Date.now(),
    });
    adapter.injectInteraction({
      type: 'hover', source: 'eye', targetEntityId: 'cube-2', timestamp: Date.now(),
    });
    const events = await adapter.pollInteractions();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('select');
    expect(events[0].targetEntityId).toBe('cube-1');
    expect(events[1].source).toBe('eye');
    const empty = await adapter.pollInteractions();
    expect(empty).toHaveLength(0);
  });

  it('maps entities to interaction handlers', async () => {
    const adapter = new XrInputAdapter();
    const handled: string[] = [];
    await adapter.mapEntityInteraction('cube-1', (event) => handled.push(event.type));
    adapter.injectInteraction({
      type: 'select', source: 'hand', targetEntityId: 'cube-1', timestamp: Date.now(),
    });
    adapter.injectInteraction({
      type: 'hover', source: 'hand', targetEntityId: 'cube-1', timestamp: Date.now(),
    });
    expect(handled).toHaveLength(2);
  });

  it('unmaps entities', async () => {
    const adapter = new XrInputAdapter();
    const handled: string[] = [];
    await adapter.mapEntityInteraction('cube-1', () => handled.push('hit'));
    await adapter.unmapEntityInteraction('cube-1');
    adapter.injectInteraction({
      type: 'select', source: 'hand', targetEntityId: 'cube-1', timestamp: Date.now(),
    });
    expect(handled).toHaveLength(0);
  });
});
