import type { ResourceType } from './limits';

export type CheckQuotaResult =
  | {
      allowed: true;
      orgUsed: number;
      orgLimit: number;
      platformUsed: number;
      platformLimit: number;
    }
  | {
      allowed: false;
      reason: 'org_limit' | 'platform_limit';
      orgUsed: number;
      orgLimit: number;
      platformUsed: number;
      platformLimit: number;
    };

export type RecordUsageResult = {
  orgUsed: number;
  platformUsed: number;
};

export type AlertType = 'org_80pct' | 'org_100pct' | 'platform_80pct' | 'platform_100pct';

export type AlertScope =
  | { kind: 'org'; orgId: string; resourceType: ResourceType; alertType: 'org_80pct' | 'org_100pct' }
  | { kind: 'platform'; resourceType: ResourceType; alertType: 'platform_80pct' | 'platform_100pct' };
