import { describe, it, expect } from 'vitest';
import { ToolRegistry, assignPhoneticNames, buildDisambiguationWaypoint, ambiguityToWaypoint } from './collaborative-narrowing';
import type { SemanticEntity } from '@usir/protocol/entities';

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'test.tool', description: 'A test tool', execute: async () => ({}) });
    const tool = reg.getTool('test.tool');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('test.tool');
  });

  it('returns undefined for unknown tools', () => {
    const reg = new ToolRegistry();
    expect(reg.getTool('nonexistent')).toBeUndefined();
  });

  it('toJSON returns serializable format', () => {
    const reg = new ToolRegistry();
    reg.register({ name: 't1', description: 'd1', execute: async () => ({}) });
    reg.register({ name: 't2', description: 'd2', execute: async () => ({}) });
    const json = reg.toJSON();
    expect(json).toEqual([{ name: 't1', description: 'd1' }, { name: 't2', description: 'd2' }]);
  });
});

describe('assignPhoneticNames', () => {
  it('assigns NATO names in order', () => {
    const entities: SemanticEntity[] = [
      { id: 'f1', role: 'function', displayName: 'foo', attributes: {}, relations: [], updatedAt: 0, source: 'test' },
      { id: 'f2', role: 'function', displayName: 'bar', attributes: {}, relations: [], updatedAt: 0, source: 'test' },
    ];
    const map = assignPhoneticNames(entities);
    expect(map.get('f1')).toBe('Alpha');
    expect(map.get('f2')).toBe('Bravo');
  });
});

describe('buildDisambiguationWaypoint', () => {
  it('builds a waypoint with candidates', () => {
    const candidates: SemanticEntity[] = [
      { id: 'f1', role: 'function', displayName: 'calculateTotal', attributes: {}, relations: [], updatedAt: 0, source: 'test' },
    ];
    const wp = buildDisambiguationWaypoint({
      waypointId: 'wp-1',
      rawInstruction: 'open it',
      candidates,
    });
    expect(wp.id).toBe('wp-1');
    expect(wp.presentations.display?.options).toHaveLength(1);
    expect(wp.presentations.audio?.tts).toContain('Alpha');
    expect(wp.fallback.onExhaustion).toBe('queue');
  });
});

describe('ambiguityToWaypoint', () => {
  it('converts ambiguity to waypoint', () => {
    const candidates: SemanticEntity[] = [
      { id: 'f1', role: 'function', displayName: 'foo', attributes: {}, relations: [], updatedAt: 0, source: 'test' },
    ];
    const wp = ambiguityToWaypoint(
      { field: 'steps[0].args.target', candidates: ['f1'], question: 'Which file?' },
      candidates,
    );
    expect(wp.context.state).toBe('disambiguation');
    expect(wp.presentations.display?.prompt).toContain('Which file?');
  });
});
