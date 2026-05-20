import ReportWorkspace from '../components/ReportWorkspace';
import { CVCNavbar } from '../components/CVCNavbar';

export default function ReportsPage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      <CVCNavbar />
      <div className="max-w-screen-2xl mx-auto px-6 py-8">
        <ReportWorkspace />
      </div>
    </div>
  );
}
