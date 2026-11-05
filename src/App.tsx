/** OpenField shell: top bar + routed page. */
import { lazy, Suspense, useEffect } from 'react';
import { APPS, badgeLabel } from './catalog';
import { linkProps, useRoute } from './router';
import { startLive, useStore } from './store';
import { useGlobalDrop } from './drop';
import { GpuChip, JudgeBanner, Logo, Toast } from './ui';
import VideoPage from './pages/Video';
import ImagePage from './pages/Image';
import DirectorPage from './pages/Director';
import MirrorPage from './pages/Mirror';
import ReshootPage from './pages/Reshoot';
import EffectsPage from './pages/Effects';
import UpscalePage from './pages/Upscale';
import ExtendPage from './pages/Extend';
import SpeakPage from './pages/Speak';
import EditPage from './pages/Edit';
import CastPage from './pages/Cast';
import CutoutPage from './pages/Cutout';
// three.js is only needed by Stage and Object: load them when opened, not on every page
const StagePage = lazy(() => import('./pages/Stage'));
const ObjectPage = lazy(() => import('./pages/Object'));
import { Apps, Explore, Library, Soon } from './pages/Home';
import Setup from './pages/Setup';
const StudioPage = lazy(() => import('./pages/Studio'));

const SECTIONS = [
  { to: '/', label: 'Studio' },
  { to: '/explore', label: 'Explore' },
  { to: '/image', label: 'Image' },
  { to: '/edit', label: 'Edit' },
  { to: '/video', label: 'Video' },
  { to: '/apps', label: 'Apps' },
  { to: '/library', label: 'Library' },
];
const APP_LINKS = APPS.filter((a) => ['director', 'stage', 'loop', 'mirror', 'reshoot', 'upscale'].includes(a.id));

export default function App() {
  const { path, params } = useRoute();
  useEffect(() => { startLive(); }, []);
  const drop = useGlobalDrop();
  const judge = useStore((s) => !!s.status?.judge);

  const page = (() => {
    if (path === '/') return <StudioPage />;
    if (path === '/image') return <ImagePage />;
    if (path === '/video') return <VideoPage />;
    if (path === '/director') return <DirectorPage />;
    if (path === '/mirror') return <MirrorPage />;
    if (path === '/reshoot') return <ReshootPage />;
    if (path === '/effects') return <EffectsPage />;
    if (path === '/upscale') return <UpscalePage />;
    if (path === '/extend') return <ExtendPage />;
    if (path === '/speak') return <SpeakPage />;
    if (path === '/edit') return <EditPage />;
    if (path === '/cast') return <CastPage />;
    if (path === '/cutout') return <CutoutPage />;
    if (path === '/stage') return <StagePage />;
    if (path === '/object') return <ObjectPage />;
    if (path === '/apps') return <Apps />;
    if (path === '/library') return <Library />;
    if (path === '/setup') return <Setup />;
    return <Explore />;
  })();

  // the tab says where you are
  useEffect(() => {
    const name = path === '/' ? 'Studio' : path === '/explore' ? 'Explore' : path === '/setup' ? 'Setup' : path === '/library' ? 'Library'
      : APPS.find((a) => a.route.split('?')[0] === path)?.name ?? SECTIONS.find((s) => s.to === path)?.label;
    document.title = name ? `${name} · Open Higgs` : 'Open Higgs';
  }, [path]);

  const isActive = (to: string) => {
    if (to === '/') return path === '/';
    const [p, q] = to.split('?');
    if (p !== path) return false;
    if (!q) return !(path === '/video' && params.get('mode') === 'loop');
    return [...new URLSearchParams(q)].every(([k, v]) => params.get(k) === v);
  };

  return (
    <div className={`app ${judge ? 'has-judge' : ''}`}>
      <header className="topbar">
        <a className="brand" {...linkProps('/')}><Logo /><span className="brand-word">Open Higgs</span></a>
        <nav className="nav">
          {SECTIONS.map((s) => <a key={s.to} className={`nav-link ${isActive(s.to) ? 'active' : ''}`} {...linkProps(s.to)}>{s.label}</a>)}
          <span className="nav-sep" />
          {APP_LINKS.map((a) => (
            <a key={a.id} className={`nav-link ${isActive(a.route) ? 'active' : ''}`} {...linkProps(a.route)}>
              {a.name}{a.badge === 'new' && <span className="badge">{badgeLabel(a.badge)}</span>}
            </a>
          ))}
          <a className={`nav-link nav-setup ${isActive('/setup') ? 'active' : ''}`} {...linkProps('/setup')}>Setup</a>
        </nav>
        <div className="topbar-right">
          <a className="nav-link" {...linkProps('/setup')} title="Models and setup">Setup</a>
          {path === '/' ? <a className="nav-link" {...linkProps('/setup')}>Compute setup ↗</a> : <GpuChip />}
        </div>
      </header>
      <JudgeBanner />
      <main className="main"><Suspense fallback={null}>{page}</Suspense></main>
      {drop.dragging && drop.label && <div className="drop-veil" aria-hidden><span>{drop.label}</span></div>}
      <Toast />
    </div>
  );
}
