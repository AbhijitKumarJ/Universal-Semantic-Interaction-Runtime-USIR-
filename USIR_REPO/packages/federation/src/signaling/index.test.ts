import { describe, it, expect } from 'vitest';
import { SignalingServer } from './index';

describe('SignalingServer', () => {
  it('starts empty', () => {
    const srv = new SignalingServer();
    expect(srv.getPeerCount()).toBe(0);
    expect(srv.getOnlinePeers()).toEqual([]);
    expect(srv.getRecentMessages()).toEqual([]);
  });

  it('registers and unregisters peers', () => {
    const srv = new SignalingServer();
    const send = () => {};
    srv.register('peer-1', send);
    expect(srv.isOnline('peer-1')).toBe(true);
    expect(srv.getPeerCount()).toBe(1);
    srv.unregister('peer-1');
    expect(srv.isOnline('peer-1')).toBe(false);
  });

  it('send delivers envelope to target peer', () => {
    const srv = new SignalingServer();
    let received: any = null;
    srv.register('peer-1', (env) => { received = env; });
    const envelope = { type: 'test', payload: { msg: 'hello' }, from: 'peer-2', to: 'peer-1', timestamp: Date.now(), ttl: 1 };
    const ok = srv.send('peer-1', envelope as any);
    expect(ok).toBe(true);
    expect(received).toEqual(envelope);
  });

  it('send returns false for unknown peer', () => {
    const srv = new SignalingServer();
    const ok = srv.send('ghost', {} as any);
    expect(ok).toBe(false);
  });

  it('broadcast sends to all peers except excluded', () => {
    const srv = new SignalingServer();
    const received: string[] = [];
    srv.register('a', () => received.push('a'));
    srv.register('b', () => received.push('b'));
    srv.register('c', () => received.push('c'));
    srv.broadcast({} as any, 'b');
    expect(received).toEqual(['a', 'c']);
  });

  it('getRecentMessages returns logged messages', () => {
    const srv = new SignalingServer();
    srv.register('p1', () => {});
    const env = { type: 'test', payload: {}, from: 'p2', to: 'p1', timestamp: 1, ttl: 1 };
    srv.send('p1', env as any);
    const msgs = srv.getRecentMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual(env);
  });

  it('clear resets all state', () => {
    const srv = new SignalingServer();
    srv.register('p1', () => {});
    srv.send('p1', { type: 'test', payload: {}, from: 'p2', to: 'p1', timestamp: 1, ttl: 1 } as any);
    srv.clear();
    expect(srv.getPeerCount()).toBe(0);
    expect(srv.getRecentMessages()).toEqual([]);
  });

  describe('persistence', () => {
    it('toJSON/fromJSON roundtrip preserves message log', () => {
      const srv = new SignalingServer();
      srv.register('p1', () => {});
      const env = { type: 'test', payload: { data: 1 }, from: 'p2', to: 'p1', timestamp: 100, ttl: 2 };
      srv.send('p1', env as any);

      const json = srv.toJSON();
      expect(json.messageLog).toHaveLength(1);

      const restored = new SignalingServer();
      restored.fromJSON(json);
      expect(restored.getRecentMessages()).toHaveLength(1);
      expect(restored.getRecentMessages()[0]).toEqual(env);
    });

    it('save/load file roundtrip preserves message log', () => {
      const path = '/tmp/usir-test-signaling.json';
      const srv = new SignalingServer();
      srv.register('p1', () => {});
      const env = { type: 'test', payload: { msg: 'hello' }, from: 'p2', to: 'p1', timestamp: 200, ttl: 3 };
      srv.send('p1', env as any);
      srv.save(path);

      const loaded = new SignalingServer();
      const ok = loaded.load(path);
      expect(ok).toBe(true);
      expect(loaded.getRecentMessages()).toHaveLength(1);
    });

    it('load returns false for missing file', () => {
      const srv = new SignalingServer();
      const ok = srv.load('/tmp/usir-test-signaling-nonexistent.json');
      expect(ok).toBe(false);
    });

    it('peers are NOT persisted (only message log)', () => {
      const srv = new SignalingServer();
      srv.register('p1', () => {});
      const json = srv.toJSON();
      expect(json.messageLog).toEqual([]);
    });
  });
});
