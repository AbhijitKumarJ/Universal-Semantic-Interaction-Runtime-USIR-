import { describe, it, expect } from 'vitest';
import { InteractionMemory } from './interaction-memory';
import type { SemanticEntity } from '@usir/protocol/entities';

describe('InteractionMemory', () => {
  it('starts empty', () => {
    const mem = new InteractionMemory('user-1');
    const snap = mem.snapshot();
    expect(snap.recentEntityIds).toEqual([]);
    expect(snap.lastDiscussedEntityId).toBeNull();
    expect(snap.userId).toBe('user-1');
  });

  it('pushes entity to history', () => {
    const mem = new InteractionMemory('user-1');
    mem.pushToHistory('e1');
    expect(mem.snapshot().recentEntityIds).toEqual(['e1']);
  });

  it('moves existing entity to front on re-push', () => {
    const mem = new InteractionMemory('user-1');
    mem.pushToHistory('e1');
    mem.pushToHistory('e2');
    mem.pushToHistory('e1');
    expect(mem.snapshot().recentEntityIds).toEqual(['e1', 'e2']);
  });

  it('enforces history limit of 50', () => {
    const mem = new InteractionMemory('user-1');
    for (let i = 0; i < 60; i++) {
      mem.pushToHistory(`e${i}`);
    }
    expect(mem.snapshot().recentEntityIds).toHaveLength(50);
    expect(mem.snapshot().recentEntityIds[0]).toBe('e59');
  });

  it('records conversation turns when rawInput provided', () => {
    const mem = new InteractionMemory('user-1');
    mem.pushToHistory('e1', { rawInput: 'open file' });
    expect(mem.snapshot().conversationHistory).toHaveLength(1);
    expect(mem.snapshot().conversationHistory[0].rawInput).toBe('open file');
  });

  describe('resolve', () => {
    it('resolves temporal reference to most recent', () => {
      const mem = new InteractionMemory('user-1');
      mem.pushToHistory('e1');
      mem.pushToHistory('e2');
      const result = mem.resolve(
        { kind: 'temporal', eventType: 'latest' },
        [],
      );
      expect(result).toBe('e2');
    });

    it('resolves conversational "previous" to most recent', () => {
      const mem = new InteractionMemory('user-1');
      mem.pushToHistory('e1');
      mem.pushToHistory('e2');
      const result = mem.resolve(
        { kind: 'conversational', position: 'previous' },
        [],
      );
      expect(result).toBe('e2');
    });

    it('resolves conversational "first" to oldest in history', () => {
      const mem = new InteractionMemory('user-1');
      mem.pushToHistory('e1');
      mem.pushToHistory('e2');
      const result = mem.resolve(
        { kind: 'conversational', position: 'first' },
        [],
      );
      expect(result).toBe('e1');
    });

    it('resolves semantic reference by display name', () => {
      const mem = new InteractionMemory('user-1');
      const candidates: SemanticEntity[] = [
        { id: 'f1', role: 'function', displayName: 'calculateTotal', attributes: {}, relations: [], updatedAt: 0, source: 'test' },
        { id: 'f2', role: 'function', displayName: 'formatDate', attributes: {}, relations: [], updatedAt: 0, source: 'test' },
      ];
      const result = mem.resolve(
        { kind: 'semantic', description: 'calculateTotal' },
        candidates,
      );
      expect(result).toBe('f1');
    });

    it('resolves semantic reference by role', () => {
      const mem = new InteractionMemory('user-1');
      const candidates: SemanticEntity[] = [
        { id: 'f1', role: 'function', displayName: 'foo', attributes: {}, relations: [], updatedAt: 0, source: 'test' },
        { id: 'c1', role: 'class', displayName: 'Foo', attributes: {}, relations: [], updatedAt: 0, source: 'test' },
      ];
      const result = mem.resolve(
        { kind: 'semantic', description: 'class' },
        candidates,
      );
      expect(result).toBe('c1');
    });

    it('resolves spatial reference with direction', () => {
      const mem = new InteractionMemory('user-1');
      const anchor: SemanticEntity = {
        id: 'a1', role: 'ui_region', displayName: 'Editor',
        spatial: { x: 0, y: 0, width: 500, height: 400 },
        attributes: {}, relations: [], updatedAt: 0, source: 'test',
      };
      const below: SemanticEntity = {
        id: 'p1', role: 'panel', displayName: 'Terminal',
        spatial: { x: 0, y: 500, width: 500, height: 200 },
        attributes: {}, relations: [], updatedAt: 0, source: 'test',
      };
      const result = mem.resolve(
        { kind: 'spatial', anchorEntityId: 'a1', direction: 'below' },
        [anchor, below],
      );
      expect(result).toBe('p1');
    });

    it('returns null when no match', () => {
      const mem = new InteractionMemory('user-1');
      const result = mem.resolve(
        { kind: 'conversational', position: 'previous' },
        [],
      );
      expect(result).toBeNull();
    });
  });

  it('clears all state', () => {
    const mem = new InteractionMemory('user-1');
    mem.pushToHistory('e1', { rawInput: 'test' });
    mem.clear();
    const snap = mem.snapshot();
    expect(snap.recentEntityIds).toEqual([]);
    expect(snap.lastDiscussedEntityId).toBeNull();
    expect(snap.conversationHistory).toEqual([]);
  });

  describe('persistence', () => {
    it('toJSON/fromJSON roundtrip preserves state', () => {
      const mem = new InteractionMemory('user-1');
      mem.pushToHistory('e1', { rawInput: 'hello' });
      mem.pushToHistory('e2');
      const json = mem.toJSON();
      const restored = new InteractionMemory('');
      restored.fromJSON(json);
      expect(restored.snapshot()).toEqual(mem.snapshot());
    });

    it('toJSON includes all fields', () => {
      const mem = new InteractionMemory('user-99');
      mem.pushToHistory('e1', { rawInput: 'test' });
      const json = mem.toJSON();
      expect(json.userId).toBe('user-99');
      expect(json.history).toEqual(['e1']);
      expect(json.conversationHistory).toHaveLength(1);
      expect(json.lastDiscussed).toBe('e1');
      expect(typeof json.sessionStartedAt).toBe('number');
    });

    it('save/load file roundtrip preserves state', () => {
      const path = '/tmp/usir-test-interaction-memory.json';
      const mem = new InteractionMemory('user-persist');
      mem.pushToHistory('e1', { rawInput: 'persist test' });
      mem.pushToHistory('e2');
      mem.save(path);

      const loaded = new InteractionMemory('');
      const ok = loaded.load(path);
      expect(ok).toBe(true);
      expect(loaded.snapshot()).toEqual(mem.snapshot());
    });

    it('load returns false for missing file', () => {
      const mem = new InteractionMemory('user-1');
      const ok = mem.load('/tmp/usir-test-nonexistent.json');
      expect(ok).toBe(false);
    });

    it('fromJSON with empty data uses defaults', () => {
      const mem = new InteractionMemory('user-default');
      mem.fromJSON({} as any);
      const snap = mem.snapshot();
      expect(snap.recentEntityIds).toEqual([]);
      expect(snap.lastDiscussedEntityId).toBeNull();
    });
  });
});
