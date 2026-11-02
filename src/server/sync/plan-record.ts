import type { PcoPlan } from '../../shared/types';
import type { PlanUpsertInput } from '../db/repo';

/** Map a PCO plan to the local `service_plans` row shape. */
export function normalizePlan(plan: PcoPlan): PlanUpsertInput {
  return {
    pcoPlanId: plan.id,
    serviceTypeId: plan.serviceTypeId,
    title: plan.title,
    seriesTitle: plan.seriesTitle,
    sortDate: plan.sortDate,
    planDate: plan.planDate,
    pcoUpdatedAt: plan.updatedAt,
  };
}
