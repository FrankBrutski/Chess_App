import { useEffect } from 'react';
import { useRoute } from './router';
import { Library } from './pages/Library';
import { CoursePage } from './pages/Course';
import { ImportPage } from './pages/Import';
import { Reader } from './pages/Reader';
import { Settings } from './pages/Settings';
import { TrainPage } from './pages/Train';
import { IssuesPage } from './pages/Issues';
import { requestPersistence } from './lib/db';

export function App() {
  const [page, id, sub, sub2] = useRoute();
  useEffect(() => {
    void requestPersistence();
  }, []);
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
    case 'settings':
      return <Settings />;
    default:
      return <Library />;
  }
}
