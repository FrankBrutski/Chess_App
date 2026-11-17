import { useEffect } from 'react';
import { useRoute } from './router';
import { Library } from './pages/Library';
import { CoursePage } from './pages/Course';
import { ImportPage } from './pages/Import';
import { Reader } from './pages/Reader';
import { Settings } from './pages/Settings';
import { IssuesPage } from './pages/Issues';
import { requestPersistence } from './lib/db';

export function App() {
  const [page, id, sub] = useRoute();
  useEffect(() => {
    void requestPersistence();
  }, []);
  switch (page) {
    case 'course':
      return <CoursePage courseId={id} />;
    case 'read':
      return <Reader chapterId={id} startNodeId={sub} />;
    case 'import':
      return <ImportPage courseId={id} />;
    case 'issues':
      return <IssuesPage courseId={id} />;
    case 'settings':
      return <Settings />;
    default:
      return <Library />;
  }
}
