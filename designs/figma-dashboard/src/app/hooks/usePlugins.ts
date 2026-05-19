/**
 * usePlugins — fetches the list of installed plugins from GET /config/plugins.
 *
 * Returns plugin nav declarations so the navbar can inject plugin links.
 * Module-level cache so the fetch runs at most once per page load.
 */

interface PluginNav {
  label: string;
  path:  string;
  icon:  string;
  roles?: string[];
}

export interface InstalledPlugin {
  slug:             string;
  name:             string;
  version:          string;
  prefix:           string;
  nav:              PluginNav | null;
  requires_tables:  string[];
}

let _cache: InstalledPlugin[] | null = null;
let _fetching = false;
let _listeners: Array<(plugins: InstalledPlugin[]) => void> = [];

function _notify(plugins: InstalledPlugin[]) {
  _listeners.forEach(fn => fn(plugins));
  _listeners = [];
}

async function _fetchPlugins(): Promise<InstalledPlugin[]> {
  if (_cache !== null) return _cache;
  if (_fetching) {
    return new Promise(resolve => _listeners.push(resolve));
  }
  _fetching = true;
  try {
    const res = await fetch('/config/plugins');
    if (!res.ok) { _cache = []; _notify([]); return []; }
    const data = await res.json();
    _cache = (data.plugins ?? []) as InstalledPlugin[];
    _notify(_cache);
    return _cache;
  } catch {
    _cache = [];
    _notify([]);
    return [];
  } finally {
    _fetching = false;
  }
}

import { useState, useEffect } from 'react';

export function usePlugins(): InstalledPlugin[] {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>(_cache ?? []);

  useEffect(() => {
    if (_cache !== null) {
      setPlugins(_cache);
      return;
    }
    _fetchPlugins().then(setPlugins);
  }, []);

  return plugins;
}
