export interface TelemetryPoint {
  timestamp: number;
  sensorId: string;
  metric: string;
  value: number;
  unit: string;
}

export interface AggregatedMetric {
  avg: number;
  min: number;
  max: number;
  count: number;
  stddev: number;
}

export interface ThresholdRule {
  sensorId: string;
  metric: string;
  label: string;
  min?: number;
  max?: number;
  cooldownMs: number;
  onBreach: (point: TelemetryPoint, rule: ThresholdRule) => void;
}

export interface TimeWindow {
  sensorId: string;
  metric: string;
  from: number;
  to: number;
}

export class SensorFusionAdapter {
  private telemetry: TelemetryPoint[] = [];
  private thresholds: ThresholdRule[] = [];
  private lastBreach = new Map<string, number>();

  ingest(point: TelemetryPoint): void {
    this.telemetry.push(point);
    this.checkThresholds(point);
  }

  query(options: { sensorId?: string; metric?: string; from?: number; to?: number }): TelemetryPoint[] {
    let results = [...this.telemetry];
    if (options.sensorId) results = results.filter((p) => p.sensorId === options.sensorId);
    if (options.metric) results = results.filter((p) => p.metric === options.metric);
    if (options.from !== undefined) results = results.filter((p) => p.timestamp >= options.from!);
    if (options.to !== undefined) results = results.filter((p) => p.timestamp <= options.to!);
    return results;
  }

  aggregate(sensorId: string, metric: string, windowMs: number): AggregatedMetric {
    const now = Date.now();
    const points = this.telemetry.filter(
      (p) => p.sensorId === sensorId && p.metric === metric && p.timestamp >= now - windowMs,
    );
    if (points.length === 0) return { avg: 0, min: 0, max: 0, count: 0, stddev: 0 };

    const values = points.map((p) => p.value);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const variance = values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    return { avg, min, max, count: values.length, stddev };
  }

  addThreshold(rule: ThresholdRule): void {
    this.thresholds.push(rule);
  }

  removeThreshold(sensorId: string, metric: string): void {
    this.thresholds = this.thresholds.filter(
      (r) => !(r.sensorId === sensorId && r.metric === metric),
    );
  }

  listThresholds(): ThresholdRule[] {
    return [...this.thresholds];
  }

  getTools() {
    return [
      {
        name: 'iot.sensor.ingest',
        description: 'Ingest a telemetry data point. Args: { sensorId: string, metric: string, value: number, unit: string }',
        execute: async (args: Record<string, unknown>) => {
          const sensorId = args.sensorId as string;
          const metric = args.metric as string;
          const value = args.value as number;
          const unit = args.unit as string;
          if (!sensorId || !metric || value === undefined || !unit) {
            throw new Error('sensorId, metric, value, and unit are required');
          }
          const point: TelemetryPoint = { timestamp: Date.now(), sensorId, metric, value, unit };
          this.ingest(point);
          return { success: true, point };
        },
      },
      {
        name: 'iot.sensor.query',
        description: 'Query telemetry data. Args: { sensorId?: string, metric?: string, from?: number, to?: number }',
        execute: async (args: Record<string, unknown>) => {
          const results = this.query({
            sensorId: args.sensorId as string | undefined,
            metric: args.metric as string | undefined,
            from: args.from as number | undefined,
            to: args.to as number | undefined,
          });
          return { count: results.length, results };
        },
      },
      {
        name: 'iot.sensor.aggregate',
        description: 'Aggregate telemetry over a time window. Args: { sensorId: string, metric: string, windowMs: number }',
        execute: async (args: Record<string, unknown>) => {
          const sensorId = args.sensorId as string;
          const metric = args.metric as string;
          const windowMs = args.windowMs as number;
          if (!sensorId || !metric || !windowMs) throw new Error('sensorId, metric, and windowMs are required');
          const result = this.aggregate(sensorId, metric, windowMs);
          return { sensorId, metric, ...result };
        },
      },
      {
        name: 'iot.sensor.addThreshold',
        description: 'Add a threshold alert rule. Args: { sensorId: string, metric: string, label: string, min?: number, max?: number, cooldownMs?: number }',
        execute: async (args: Record<string, unknown>) => {
          const sensorId = args.sensorId as string;
          const metric = args.metric as string;
          const label = args.label as string;
          if (!sensorId || !metric || !label) throw new Error('sensorId, metric, and label are required');
          const rule: ThresholdRule = {
            sensorId, metric, label,
            min: args.min as number | undefined,
            max: args.max as number | undefined,
            cooldownMs: (args.cooldownMs as number) ?? 5000,
            onBreach: () => {},
          };
          this.addThreshold(rule);
          return { success: true, rule: { sensorId, metric, label, min: rule.min, max: rule.max } };
        },
      },
      {
        name: 'iot.sensor.removeThreshold',
        description: 'Remove a threshold alert rule. Args: { sensorId: string, metric: string }',
        execute: async (args: Record<string, unknown>) => {
          const sensorId = args.sensorId as string;
          const metric = args.metric as string;
          if (!sensorId || !metric) throw new Error('sensorId and metric are required');
          this.removeThreshold(sensorId, metric);
          return { success: true };
        },
      },
    ];
  }

  private checkThresholds(point: TelemetryPoint): void {
    for (const rule of this.thresholds) {
      if (rule.sensorId !== point.sensorId || rule.metric !== point.metric) continue;
      const breachKey = `${rule.sensorId}:${rule.metric}:${rule.label}`;
      const lastTime = this.lastBreach.get(breachKey) ?? 0;
      if (Date.now() - lastTime < rule.cooldownMs) continue;

      if ((rule.min !== undefined && point.value < rule.min) ||
          (rule.max !== undefined && point.value > rule.max)) {
        this.lastBreach.set(breachKey, Date.now());
        try { rule.onBreach(point, rule); } catch { /* handler error */ }
      }
    }
  }
}
