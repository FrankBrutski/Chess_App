import { lazy, Suspense, useEffect } from 'react';
import { useRoute } from './router';
import { Home } from './pages/Home';
import { Library } from './pages/Library';
import { CoursePage } from './pages/Course';
import { Reader } from './pages/Reader';
import { requestPersistence } from './lib/db';
import { UpdateBanner } from './components/UpdateBanner';

// Screens you open less often load on first use (all files are still bundled and cached offline).
const ImportPage = lazy(() => import('./pages/Import').then((m) => ({ default: m.ImportPage })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const TrainPage = lazy(() => import('./pages/Train').then((m) => ({ default: m.TrainPage })));
const MasterBoard = lazy(() => import('./pages/MasterBoard').then((m) => ({ default: m.MasterBoard })));
const StingsPage = lazy(() => import('./pages/Stings').then((m) => ({ default: m.StingsPage })));
const StingDrill = lazy(() => import('./pages/StingDrill').then((m) => ({ default: m.StingDrill })));
const StingCard = lazy(() => import('./pages/StingCard').then((m) => ({ default: m.StingCard })));
const IssuesPage = lazy(() => import('./pages/Issues').then((m) => ({ default: m.IssuesPage })));

export function App() {
  const [page, id, sub, sub2] = useRoute();
  useEffect(() => {
    void requestPersistence();
  }, []);
  return (
    <>
      <Suspense fallback={<div className="page" />}>{route(page, id, sub, sub2)}</Suspense>
      <UpdateBanner />
    </>
  );
}

function route(page: string | undefined, id: string, sub: string, sub2: string) {
  switch (page) {
    case 'course':
      return <CoursePage courseId={id} />;
    case 'read':
      return <Reader chapterId={id} startNodeId={sub} />;
    case 'line':
      return <Reader chapterId={id} lineId={sub ? decodeURIComponent(sub) : undefined} lineNodeId={sub2} />;
    case 'import':
      return <ImportPage courseId={id} sectionId={sub} />;
    case 'issues':
      return <IssuesPage courseId={id} />;
    case 'train':
      return <TrainPage kind={id} a={sub} b={sub2} />;
    case 'board':
      return <MasterBoard />;
    case 'settings':
      return <Settings />;
    case 'openings':
      return <Library />;
    case 'stings':
      return id === 'drill' ? <StingDrill /> : <StingsPage tab={id} />;
    case 'sting':
      return <StingCard id={id} />;
    default:
      return <Home />;
  }
}
