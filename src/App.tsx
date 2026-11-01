import { lazy, Suspense, useEffect } from 'react';
import { Layout } from './components/Layout';
import { Toasts } from './components/Toasts';
import { Create } from './pages/Create';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';
import { useHashRoute } from './router';
import { GameProvider, useGame } from './store';

// 路由级代码分割：社交/档案/行动页按需加载，首屏只带首页与人生页
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Actions = lazy(() => import('./pages/Actions').then((m) => ({ default: m.Actions })));
const Social = lazy(() => import('./pages/Social').then((m) => ({ default: m.Social })));
const Archive = lazy(() => import('./pages/Archive').then((m) => ({ default: m.Archive })));

const GAME_ROUTES = ['/play', '/actions', '/social', '/archive'];

const Fallback = () => <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">加载中…</div>;

function Router() {
  const [path, go] = useHashRoute();
  const { ready, state } = useGame();
  const needsGame = GAME_ROUTES.includes(path);

  useEffect(() => { if (ready && needsGame && !state) go('/'); }, [ready, needsGame, state, go]);

  if (!ready) return <div className="flex min-h-screen items-center justify-center text-slate-500">正在读取存档…</div>;
  if (path === '/create') return <><Toasts /><Create go={go} /></>;
  if (path === '/settings') return <><Toasts /><Settings go={go} /></>;
  if (needsGame && state) {
    return (
      <Layout path={path} go={go}>
        <Suspense fallback={<Fallback />}>
          {path === '/play' && <Dashboard go={go} />}
          {path === '/actions' && <Actions />}
          {path === '/social' && <Social />}
          {path === '/archive' && <Archive />}
        </Suspense>
      </Layout>
    );
  }
  return <><Toasts /><Home go={go} /></>;
}

export default function App() {
  return (
    <GameProvider>
      <Router />
    </GameProvider>
  );
}
