const PACKS = {
  global: {
    name: 'global',
    notes: 'Baseline global policy checks.',
    rules: []
  },
  IN: {
    name: 'india',
    notes: 'India-focused messaging and campaign hygiene checks.',
    rules: [
      {
        id: 'in_whatsapp_marketing_template',
        when: 'whatsapp_marketing',
        severity: 'warn',
        message: 'For marketing sends, use approved templates and explicit consent list.'
      }
    ]
  },
  EU: {
    name: 'eu',
    notes: 'EU privacy-sensitive checks.',
    rules: [
      {
        id: 'eu_personal_data_guard',
        when: 'high_risk',
        severity: 'warn',
        message: 'Confirm lawful basis and privacy notice before high-risk actions involving personal data.'
      }
    ]
  }
};

function packForCountry(countryCode) {
  const cc = String(countryCode || '').trim().toUpperCase();
  if (!cc) return PACKS.global;
  if (cc === 'IN') return PACKS.IN;
  if (['DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'IE', 'PL', 'PT', 'BE', 'AT', 'DK', 'FI', 'GR', 'CZ', 'RO', 'HU', 'SK', 'SI', 'HR', 'LT', 'LV', 'EE', 'LU', 'CY', 'MT', 'BG'].includes(cc)) {
    return PACKS.EU;
  }
  return PACKS.global;
}

module.exports = {
  PACKS,
  packForCountry
};
