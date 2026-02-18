import { buildWhatsAppFixSuggestions, evaluateWhatsAppContract } from '../src/engine/integration-contract';

describe('integration contract', () => {
  it('marks contract ready only for recent passed live verification', () => {
    const now = new Date().toISOString();
    const out = evaluateWhatsAppContract({
      hasAccessToken: true,
      hasPhoneNumberId: true,
      latestLiveVerificationOk: true,
      latestLiveVerificationAt: now,
      maxAgeDays: 30
    });
    expect(out.ready).toBe(true);
    expect(out.testSendPassed).toBe(true);
  });

  it('marks stale verification as not ready', () => {
    const old = new Date(Date.now() - (40 * 24 * 60 * 60 * 1000)).toISOString();
    const out = evaluateWhatsAppContract({
      hasAccessToken: true,
      hasPhoneNumberId: true,
      latestLiveVerificationOk: true,
      latestLiveVerificationAt: old,
      maxAgeDays: 30
    });
    expect(out.stale).toBe(true);
    expect(out.ready).toBe(false);
  });

  it('returns actionable suggestions for missing and stale checks', () => {
    const suggestions = buildWhatsAppFixSuggestions({
      connected: false,
      verified: false,
      testSendPassed: false,
      stale: true,
      liveAllowed: false,
      latestVerificationStatus: 'failed'
    });
    expect(suggestions.some((x) => x.id === 'connect_access_token')).toBe(true);
    expect(suggestions.some((x) => x.id === 'set_phone_number_id')).toBe(true);
    expect(suggestions.some((x) => x.id === 'enable_live_verify')).toBe(true);
    expect(suggestions.some((x) => x.id === 'refresh_verification')).toBe(true);
  });
});
