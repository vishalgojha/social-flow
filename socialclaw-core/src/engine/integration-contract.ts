export interface WhatsAppContractInput {
  hasAccessToken: boolean;
  hasPhoneNumberId: boolean;
  latestLiveVerificationOk: boolean;
  latestLiveVerificationAt?: string;
  maxAgeDays: number;
}

export function evaluateWhatsAppContract(input: WhatsAppContractInput) {
  const connected = input.hasAccessToken;
  const verified = input.hasPhoneNumberId;
  const ts = Date.parse(String(input.latestLiveVerificationAt || ''));
  const maxAgeMs = Math.max(1, Number(input.maxAgeDays || 30)) * 24 * 60 * 60 * 1000;
  const stale = Number.isFinite(ts) ? (Date.now() - ts > maxAgeMs) : true;
  const testSendPassed = Boolean(input.latestLiveVerificationOk) && !stale;
  return {
    connected,
    verified,
    testSendPassed,
    stale,
    ready: connected && verified && testSendPassed
  };
}

export function buildWhatsAppFixSuggestions(input: {
  connected: boolean;
  verified: boolean;
  testSendPassed: boolean;
  stale: boolean;
  liveAllowed: boolean;
  latestVerificationStatus?: 'passed' | 'failed' | 'partial' | '';
}) {
  const out: Array<{ id: string; title: string; action: string }> = [];
  if (!input.connected) {
    out.push({
      id: 'connect_access_token',
      title: 'Connect WhatsApp access token',
      action: 'POST /v1/clients/:clientId/credentials/whatsapp with accessToken'
    });
  }
  if (!input.verified) {
    out.push({
      id: 'set_phone_number_id',
      title: 'Set WhatsApp phone number id',
      action: 'POST /v1/clients/:clientId/credentials/whatsapp with phoneNumberId'
    });
  }
  if (input.testSendPassed === false) {
    if (!input.liveAllowed) {
      out.push({
        id: 'enable_live_verify',
        title: 'Enable live verify mode',
        action: 'Set VERIFY_ALLOW_LIVE=true in secure environment and rerun verify'
      });
    } else if (input.latestVerificationStatus === 'failed') {
      out.push({
        id: 'retry_live_verify',
        title: 'Retry live test-send',
        action: 'POST /v1/clients/:clientId/credentials/whatsapp/verify { mode: \"live\" }'
      });
    } else {
      out.push({
        id: 'run_live_verify',
        title: 'Run live test-send verification',
        action: 'POST /v1/clients/:clientId/credentials/whatsapp/verify { mode: \"live\" }'
      });
    }
  }
  if (input.stale) {
    out.push({
      id: 'refresh_verification',
      title: 'Refresh stale verification evidence',
      action: 'Run live verify again to refresh verification timestamp'
    });
  }
  return out;
}
