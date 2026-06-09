/**
 * CVCPage — shared page-level layout components
 *
 * Usage:
 *   <PageShell>
 *     <ReportHeader eyebrow="Vertical OS · Deal Flow" title="Sourcing" subtitle="142 companies" />
 *     ...content...
 *   </PageShell>
 */

import { CVCNavbar } from './CVCNavbar';
import { cls } from './tokens';

interface PageShellProps {
  children: React.ReactNode;
  navActive?: string;
  maxWidth?: string;
}

export function PageShell({ children, navActive, maxWidth = '1400px' }: PageShellProps) {
  return (
    <div className={cls.page}>
      <CVCNavbar active={navActive} />
      <div style={{ maxWidth }} className="mx-auto px-4 py-6 md:px-6 md:py-8">
        {children}
      </div>
    </div>
  );
}

interface ReportHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function ReportHeader({ eyebrow, title, subtitle, action }: ReportHeaderProps) {
  return (
    <div className={cls.reportDivider}>
      <p className={`${cls.eyebrow} mb-2`}>{eyebrow}</p>
      <div className="flex items-baseline justify-between">
        <h1 className={cls.reportTitle}>{title}</h1>
        <div className="flex items-center gap-3">
          {subtitle && <span className="text-sm text-slate-500">{subtitle}</span>}
          {action}
        </div>
      </div>
    </div>
  );
}
