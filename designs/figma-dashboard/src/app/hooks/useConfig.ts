import { useState, useEffect } from 'react';

export interface TeamConfig {
  team_name: string;
  team_short: string;
  logo_char: string;
  sectors: string[];
  fund_names: string[];
  default_fund: string;
}

const DEFAULT_CONFIG: TeamConfig = {
  team_name: 'Vertical OS',
  team_short: 'Vertical OS',
  logo_char: 'V',
  sectors: ['Supply Chain', 'Robotics', 'Manufacturing', 'Industrial Automation', 'Physical AI', 'Other'],
  fund_names: ['Fund I', 'Family Office'],
  default_fund: 'Fund I',
};

// Module-level cache so every component gets the same object after the first fetch.
let _cache: TeamConfig | null = null;
let _promise: Promise<TeamConfig> | null = null;

function fetchConfig(): Promise<TeamConfig> {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;
  _promise = fetch('/config')
    .then(r => r.ok ? r.json() : DEFAULT_CONFIG)
    .then(data => { _cache = { ...DEFAULT_CONFIG, ...data }; return _cache; })
    .catch(() => { _cache = DEFAULT_CONFIG; return _cache; });
  return _promise;
}

export function useConfig(): TeamConfig {
  const [config, setConfig] = useState<TeamConfig>(_cache ?? DEFAULT_CONFIG);
  useEffect(() => {
    if (!_cache) {
      fetchConfig().then(setConfig);
    }
  }, []);
  return config;
}
