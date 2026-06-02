import type { RegistryStats } from '@usir/protocol/capability';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  stats: RegistryStats;
  checks: {
    storage: boolean;
    memory: boolean;
  };
}

export function getHealthStatus(
  stats: RegistryStats,
  storeSize: number,
): HealthStatus {
  const checks = {
    storage: storeSize >= 0,
    memory: true,
  };

  const allPass = Object.values(checks).every(Boolean);
  const status: HealthStatus['status'] = allPass ? 'healthy' : 'degraded';

  return {
    status,
    uptime: stats.uptime,
    version: '0.1.0',
    stats,
    checks,
  };
}
