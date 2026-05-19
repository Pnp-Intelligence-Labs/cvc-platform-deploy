import { useSearchParams } from 'react-router';
import { CVCNavbar } from '../components/CVCNavbar';
import VenturesOverview from './VenturesOverview';
import PortfolioHomepage from './PortfolioHomepage';
import CompanySearch from './CompanySearch';
import IndustrialMatrix from './IndustrialMatrix';

type Tab = 'Overview' | 'Portfolio' | 'Companies' | 'Industrial';

const TABS: Tab[] = ['Overview', 'Portfolio', 'Companies', 'Industrial'];
const VALID_TABS = new Set<string>(TABS);

export default function Ventures() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab') ?? '';
  const tab: Tab = VALID_TABS.has(raw) ? (raw as Tab) : 'Overview';

  const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true });

  return (
    <div className="min-h-screen bg-linen">
      <CVCNavbar />
      <div className="border-b border-slate-200 bg-white sticky top-14 z-40">
        <div className="max-w-[1800px] mx-auto px-8 flex gap-0">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-semibold tracking-tight border-b-2 transition-colors ${
                tab === t
                  ? 'border-cvc-gold text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'Overview'   && <VenturesOverview />}
      {tab === 'Portfolio'  && <PortfolioHomepage />}
      {tab === 'Companies'  && <CompanySearch />}
      {tab === 'Industrial' && <IndustrialMatrix />}
    </div>
  );
}
