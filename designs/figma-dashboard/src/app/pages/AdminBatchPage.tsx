import { CVCNavbar } from '../components/CVCNavbar';
import { AdminBatchJobs } from '../components/AdminBatchJobs';

export default function AdminBatchPage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      <CVCNavbar />
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        <AdminBatchJobs />
      </div>
    </div>
  );
}
