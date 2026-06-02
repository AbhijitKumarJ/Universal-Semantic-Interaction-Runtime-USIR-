import { describe, it, expect } from 'vitest';
import { SensorFusionAdapter } from './sensor-fusion-adapter';

describe('SensorFusionAdapter', () => {
  it('ingests and queries telemetry', () => {
    const adapter = new SensorFusionAdapter();
    adapter.ingest({ timestamp: 1000, sensorId: 'temp-1', metric: 'temperature', value: 22.5, unit: 'c' });
    adapter.ingest({ timestamp: 2000, sensorId: 'temp-1', metric: 'temperature', value: 23.0, unit: 'c' });
    adapter.ingest({ timestamp: 3000, sensorId: 'hum-1', metric: 'humidity', value: 60, unit: '%' });
    const all = adapter.query({});
    expect(all).toHaveLength(3);
    const filtered = adapter.query({ sensorId: 'temp-1' });
    expect(filtered).toHaveLength(2);
    const byMetric = adapter.query({ metric: 'humidity' });
    expect(byMetric).toHaveLength(1);
  });

  it('aggregates telemetry over time window', () => {
    const adapter = new SensorFusionAdapter();
    const now = Date.now();
    adapter.ingest({ timestamp: now - 4000, sensorId: 's1', metric: 'temperature', value: 20, unit: 'c' });
    adapter.ingest({ timestamp: now - 3000, sensorId: 's1', metric: 'temperature', value: 22, unit: 'c' });
    adapter.ingest({ timestamp: now - 2000, sensorId: 's1', metric: 'temperature', value: 24, unit: 'c' });
    adapter.ingest({ timestamp: now - 1000, sensorId: 's1', metric: 'temperature', value: 26, unit: 'c' });
    const agg = adapter.aggregate('s1', 'temperature', 10000);
    expect(agg.count).toBe(4);
    expect(agg.avg).toBe(23);
    expect(agg.min).toBe(20);
    expect(agg.max).toBe(26);
    expect(agg.stddev).toBeGreaterThan(0);
  });

  it('returns zero aggregate when no data', () => {
    const adapter = new SensorFusionAdapter();
    const agg = adapter.aggregate('s1', 'temperature', 1000);
    expect(agg.count).toBe(0);
    expect(agg.avg).toBe(0);
  });

  it('fires threshold alerts on breach', () => {
    const adapter = new SensorFusionAdapter();
    const breaches: Array<{ value: number; label: string }> = [];
    adapter.addThreshold({
      sensorId: 's1', metric: 'temperature', label: 'high-temp',
      max: 30, cooldownMs: 0,
      onBreach: (point) => breaches.push({ value: point.value, label: 'high-temp' }),
    });
    adapter.addThreshold({
      sensorId: 's1', metric: 'temperature', label: 'low-temp',
      min: 10, cooldownMs: 0,
      onBreach: (point) => breaches.push({ value: point.value, label: 'low-temp' }),
    });
    adapter.ingest({ timestamp: Date.now(), sensorId: 's1', metric: 'temperature', value: 35, unit: 'c' });
    adapter.ingest({ timestamp: Date.now(), sensorId: 's1', metric: 'temperature', value: 5, unit: 'c' });
    expect(breaches).toHaveLength(2);
    expect(breaches[0].value).toBe(35);
    expect(breaches[1].label).toBe('low-temp');
  });

  it('removes threshold rules', () => {
    const adapter = new SensorFusionAdapter();
    const breaches: number[] = [];
    adapter.addThreshold({
      sensorId: 's1', metric: 'temp', label: 'alert', max: 30, cooldownMs: 0,
      onBreach: () => breaches.push(1),
    });
    adapter.removeThreshold('s1', 'temp');
    adapter.ingest({ timestamp: Date.now(), sensorId: 's1', metric: 'temp', value: 35, unit: 'c' });
    expect(breaches).toHaveLength(0);
  });

  it('lists thresholds', () => {
    const adapter = new SensorFusionAdapter();
    adapter.addThreshold({
      sensorId: 's1', metric: 'temp', label: 'alert', max: 30, cooldownMs: 5000,
      onBreach: () => {},
    });
    expect(adapter.listThresholds()).toHaveLength(1);
  });
});
