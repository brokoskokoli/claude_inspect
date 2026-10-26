import type { ProcessInfo } from './types.js';

/**
 * Anzeigename einer Session. Claude Code gibt jedem Prozess einen Namen; hat niemand einen
 * vergeben (`nameSource: "derived"`), ist das der Ordnername mit Kürzel ("my-shop-48"). Dann
 * geht der Titel der Session vor (eigener Titel, Agent-Name, KI-Titel), der abgeleitete Name
 * bleibt Rückfall und Untertitel – unter ihm ist die Session für andere Sessions erreichbar.
 */
export function sessionName(proc: Pick<ProcessInfo, 'name' | 'nameSource'> | undefined, title: string | undefined): { name?: string; subtitle?: string } {
  const own = proc?.name && proc.nameSource !== 'derived' ? proc.name : undefined;
  const name = own ?? title ?? proc?.name;
  const other = own ? title : title ? proc?.name : undefined;
  return { name, subtitle: other && other !== name ? other : undefined };
}
