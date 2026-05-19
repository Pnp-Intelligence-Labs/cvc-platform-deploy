import { Navbar } from './components/Navbar';
import { HeroPanel } from './components/HeroPanel';
import { SummaryCards } from './components/SummaryCards';
import { EntriesTable } from './components/EntriesTable';
import { RouterProvider } from 'react-router';
import { router } from './routes';

export default function App() {
  return <RouterProvider router={router} />;
}