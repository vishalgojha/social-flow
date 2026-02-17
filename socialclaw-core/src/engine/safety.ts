export interface SafetyInput {
  maxActions: number;
  pendingApprovals: number;
  requestedActions: number;
}

export function enforceSafetyLimits(input: SafetyInput): void {
  if (input.pendingApprovals > 20) {
    throw Object.assign(new Error('blocked:approval_queue_overflow'), { statusCode: 409 });
  }
  if (input.requestedActions > input.maxActions) {
    throw Object.assign(new Error('blocked:execution_cap_exceeded'), { statusCode: 409 });
  }
}
