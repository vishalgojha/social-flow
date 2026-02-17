import { enforceSafetyLimits } from '../src/engine/safety';

describe('engine safety', () => {
  it('blocks when action cap exceeded', () => {
    expect(() => enforceSafetyLimits({ maxActions: 2, pendingApprovals: 0, requestedActions: 3 })).toThrow('execution_cap_exceeded');
  });

  it('allows safe range', () => {
    expect(() => enforceSafetyLimits({ maxActions: 5, pendingApprovals: 1, requestedActions: 2 })).not.toThrow();
  });
});
