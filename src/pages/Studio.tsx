import { useCallback, useEffect, useRef, useState } from 'react';
import { linkProps } from '../router';
import './studio.css';
import StudioQueue, { type QueueJob } from './StudioQueue';
import {
  ComputeHealth,
  WorkflowControls,
  SoundtrackPicker,
  type WorkflowAsset,
  type Soundtrack,
} from './StudioControls';

type Mode = 'wavespeed' | 'kie' | 'local' | 'kaggle';
type Shot = {
  id: string;
  name: string;
  prompt: string;
  duration: number;
  x: number;
  y: number;
  reference: string;
  output?: string;
};
type Project = {
  id: string;
  name: string;
  shots: Shot[];
  mode: Mode;
  model: string;
  input: string;
  workflow: string;
  bindingNode: string;
  bindingField: string;
  workflowAssets?: WorkflowAsset[];
  soundtrack?: Soundtrack;
};
type Job = {
  id: string;
  projectId: string;
  shotId: string;
  status: string;
  mode: Mode;
  outputs: string[];
  error?: string;
  created: number;
  archived?: boolean;
  archiveError?: string;
};
type Source = {
  repo: string;
  revision: string;
  license: string;
  role: string;
  status: string;
  workflows: { id: string; name: string }[];
  url: string;
};
type Provider = { id: Mode; label: string; ready: boolean; detail: string };
const uid = () => crypto.randomUUID();
const seed = (): Project => ({
  id: uid(),
  name: 'After the rain',
  mode: 'local',
  model: '',
  input: '{}',
  workflow: '',
  bindingNode: '2',
  bindingField: 'text',
  shots: [
    {
      id: uid(),
      name: 'The city wakes',
      prompt:
        'An empty city at blue hour after rain. A lone cyclist crosses the street, reflections ripple across wet asphalt. Wide cinematic shot, natural light, subtle film grain.',
      duration: 5,
      x: 60,
      y: 65,
      reference: '/presets/neon-rain.mp4',
    },
    {
      id: uid(),
      name: 'A moment of stillness',
      prompt:
        'Close-up of rain on a dark window. A soft amber light flickers in the reflection. Intimate, shallow depth of field, slow push in.',
      duration: 4,
      x: 390,
      y: 170,
      reference: '/presets/push-in.mp4',
    },
    {
      id: uid(),
      name: 'Into the light',
      prompt:
        'A figure walks toward a sunlit opening between concrete buildings. Morning mist, warm light, long shadows. The camera follows at a distance.',
      duration: 6,
      x: 720,
      y: 65,
      reference: '/presets/golden.mp4',
    },
  ],
});
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const r = await fetch('/api/studio' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error ?? `Request failed: ${r.status}`);
  return b;
}
function download(name: string, body: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
  );
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function Media({ src, reference = false }: { src?: string; reference?: boolean }) {
  if (src && /\.(wav|mp3|flac)(\?|$)/i.test(src))
    return (
      <div className="oh-audio-take">
        <span>♫</span>
        <audio src={src} controls />
      </div>
    );
  if (!src)
    return (
      <div className="oh-empty-media">
        <span>✧</span>
        <small>Your next frame starts here</small>
      </div>
    );
  const video =
    /\.(mp4|webm|mov)(\?|$)/i.test(src) || (src.includes('filename=') && /\.(mp4|webm)/i.test(src));
  return (
    <div className="oh-media">
      {video ? (
        <video src={src} muted loop autoPlay playsInline controls={!reference} />
      ) : (
        <img src={src} alt={reference ? 'Bundled reference preview' : 'Generated shot'} />
      )}
      {reference && <span className="oh-reference">REFERENCE</span>}
    </div>
  );
}

export default function Studio() {
  const [project, setProject] = useState<Project>(seed),
    [projects, setProjects] = useState<Project[]>([]),
    [selected, setSelected] = useState(''),
    [view, setView] = useState('Canvas'),
    [jobs, setJobs] = useState<Job[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [providers, setProviders] = useState<Provider[]>([]),
    [notice, setNotice] = useState(''),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [zoom, setZoom] = useState(0.85),
    [showAdvanced, setShowAdvanced] = useState(false);
  const [saveState, setSaveState] = useState('Loading project');
  const [workflowSearch, setWorkflowSearch] = useState('');
  const switchingProject = useRef(false);
  const drag = useRef<{ id: string; x: number; y: number; px: number; py: number } | null>(null);
  const file = useRef<HTMLInputElement>(null),
    importFile = useRef<HTMLInputElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    Promise.all([
      api<Project[]>('/projects'),
      api<Provider[]>('/providers'),
      api<Source[]>('/sources'),
    ])
      .then(([ps, pv, ss]) => {
        setProjects(ps);
        setProviders(pv);
        setSources(ss);
        if (ps.length) {
          setProject(ps[0]);
          setSelected(ps[0].shots[0]?.id ?? '');
        } else setSelected(projectRef.current.shots[0].id);
        setReady(true);
      })
      .catch((e) => setNotice(e.message));
  }, []);
  useEffect(() => {
    if (!ready) return;
    setSaveState('Saving');
    const t = setTimeout(() => {
      api(`/projects/${project.id}`, { method: 'PUT', body: JSON.stringify(project) })
        .then(() => {
          setSaveState('All changes saved');
          setProjects((ps) => [project, ...ps.filter((p) => p.id !== project.id)]);
        })
        .catch((e) => {
          setSaveState('Save failed');
          setNotice(e.message);
        });
    }, 450);
    return () => clearTimeout(t);
  }, [project, ready]);
  useEffect(() => {
    let active = true;
    const poll = () =>
      api<Job[]>('/jobs')
        .then((js) => {
          if (active) setJobs(js);
        })
        .catch(() => {});
    void poll();
    const t = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);
  const shot = project.shots.find((s) => s.id === selected) ?? project.shots[0];
  const shotJobs = jobs.filter((j) => j.projectId === project.id && j.shotId === shot?.id);
  const currentJob = shotJobs[0],
    completed =
      shotJobs.find(
        (j) => j.status === 'completed' && (!shot?.output || j.outputs.includes(shot.output)),
      ) ?? shotJobs.find((j) => j.status === 'completed');
  const queueableCount = project.shots.filter(
    (s) =>
      s.prompt.trim() &&
      !jobs.some(
        (j) =>
          j.projectId === project.id &&
          j.shotId === s.id &&
          ['queued', 'submitting', 'running'].includes(j.status),
      ),
  ).length;
  const update = (patch: Partial<Project>) => setProject((p) => ({ ...p, ...patch }));
  const updateShot = (patch: Partial<Shot>) =>
    setProject((p) => ({
      ...p,
      shots: p.shots.map((s) => (s.id === shot?.id ? { ...s, ...patch } : s)),
    }));
  const outputFor = (s: Shot) =>
    s.output ??
    jobs.find((j) => j.projectId === project.id && j.shotId === s.id && j.status === 'completed')
      ?.outputs[0];
  const addShot = () => {
    const s: Shot = {
      id: uid(),
      name: 'Untitled shot',
      prompt: '',
      duration: 5,
      x: 70 + project.shots.length * 80,
      y: 100 + (project.shots.length % 2) * 130,
      reference: '',
    };
    update({ shots: [...project.shots, s] });
    setSelected(s.id);
  };
  const changeMode = (mode: Mode) =>
    update({
      mode,
      model:
        mode === 'wavespeed'
          ? 'wavespeed-ai/z-image/turbo'
          : mode === 'kie'
            ? 'google/imagen4-ultra'
            : '',
      input:
        mode === 'wavespeed'
          ? '{"size":"1024*1024"}'
          : mode === 'kie'
            ? '{"aspect_ratio":"16:9"}'
            : '{}',
    });
  async function openProject(next: Project) {
    if (switchingProject.current || next.id === projectRef.current.id) return;
    switchingProject.current = true;
    try {
      const current = projectRef.current;
      await api(`/projects/${current.id}`, { method: 'PUT', body: JSON.stringify(current) });
      setProjects((ps) => [current, ...ps.filter((p) => p.id !== current.id)]);
      setProject(next);
      setSelected(next.shots[0]?.id ?? '');
    } catch (error) {
      setNotice(`Could not save the current project: ${(error as Error).message}`);
    } finally {
      switchingProject.current = false;
    }
  }
  async function queueShots() {
    const targets = project.shots.filter(
      (s) =>
        s.prompt.trim() &&
        !jobs.some(
          (j) =>
            j.projectId === project.id &&
            j.shotId === s.id &&
            ['queued', 'submitting', 'running'].includes(j.status),
        ),
    );
    if (!targets.length) {
      setNotice('Add a prompt to a shot that is not already processing.');
      return;
    }
    setBusy(true);
    try {
      const payload =
        project.mode === 'local' || project.mode === 'kaggle'
          ? {
              workflow: JSON.parse(project.workflow),
              binding: project.bindingNode
                ? { node: project.bindingNode, field: project.bindingField }
                : undefined,
              assets: project.workflowAssets ?? [],
            }
          : { input: JSON.parse(project.input) };
      await api(`/projects/${project.id}`, { method: 'PUT', body: JSON.stringify(project) });
      const result = await api<{ jobs: Job[] }>('/jobs/batch', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: uid(),
          jobs: targets.map((s) => ({
            projectId: project.id,
            shotId: s.id,
            mode: project.mode,
            model: project.model,
            prompt: s.prompt,
            payload,
          })),
        }),
      });
      setJobs((js) => [...result.jobs, ...js]);
      setView('Queue');
      setNotice(`${result.jobs.length} takes queued. You can keep editing.`);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancelQueued(job: QueueJob) {
    try {
      const updated = await api<Job>(`/jobs/${job.id}/cancel`, { method: 'POST', body: '{}' });
      setJobs((js) => js.map((j) => (j.id === updated.id ? updated : j)));
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  async function recoverTake(job: QueueJob, remoteId: string) {
    try {
      const updated = await api<Job>(`/jobs/${job.id}/recover`, {
        method: 'POST',
        body: JSON.stringify({ remoteId }),
      });
      setJobs((js) => js.map((j) => (j.id === updated.id ? updated : j)));
      setNotice('Tracking resumed for the existing task.');
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  async function generate() {
    if (!shot) return;
    setBusy(true);
    setNotice('');
    try {
      if ((project.mode === 'local' || project.mode === 'kaggle') && !project.workflow.trim())
        throw new Error('Choose a library workflow or import ComfyUI API JSON first.');
      await api(`/projects/${project.id}`, { method: 'PUT', body: JSON.stringify(project) });
      const payload =
        project.mode === 'local' || project.mode === 'kaggle'
          ? {
              workflow: JSON.parse(project.workflow),
              binding: project.bindingNode
                ? { node: project.bindingNode, field: project.bindingField }
                : undefined,
              assets: project.workflowAssets ?? [],
            }
          : { input: JSON.parse(project.input) };
      const j = await api<Job>('/jobs', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: uid(),
          projectId: project.id,
          shotId: shot.id,
          mode: project.mode,
          model: project.model,
          prompt: shot.prompt,
          payload,
        }),
      });
      setJobs((js) => [j, ...js]);
      setNotice('Take queued. You can keep working.');
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadWorkflow(id: string) {
    try {
      const [graph, settings] = await Promise.all([
        api<Record<string, any>>(`/workflows/${id}`),
        api<{ binding?: { node: string; field: string } }>(`/workflows/${id}/settings`),
      ]);
      const candidate = Object.entries(graph).find(
        ([_, n]) =>
          n.class_type === 'CLIPTextEncode' &&
          typeof n.inputs?.text === 'string' &&
          n.inputs.text.length > 30,
      );
      update({
        workflow: JSON.stringify(graph, null, 2),
        bindingNode: settings.binding?.node ?? candidate?.[0] ?? '',
        bindingField: settings.binding?.field ?? 'text',
        workflowAssets: [],
      });
      setNotice('Workflow loaded. Review inputs, models and prompt binding before rendering.');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  const move = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      setProject((p) => ({
        ...p,
        shots: p.shots.map((s) =>
          s.id === d.id
            ? {
                ...s,
                x: Math.max(0, d.x + (e.clientX - d.px) / zoom),
                y: Math.max(0, d.y + (e.clientY - d.py) / zoom),
              }
            : s,
        ),
      }));
    },
    [zoom],
  );
  async function archiveTake(job: Job) {
    try {
      setNotice('Saving media to your studio…');
      const result = await api<{ outputs?: string[] }>(`/jobs/${job.id}/archive`, {
        method: 'POST',
        body: '{}',
      });
      if (!result.outputs) {
        setNotice('This take is already being saved.');
        return;
      }
      if (result.outputs) {
        const outputs = result.outputs;
        setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, outputs, archived: true } : j)));
        setProject((p) => ({
          ...p,
          shots: p.shots.map((s) =>
            s.output && job.outputs.includes(s.output)
              ? { ...s, output: outputs[job.outputs.indexOf(s.output)] }
              : s,
          ),
        }));
      }
      setNotice('Media saved locally. This take no longer depends on its provider URL.');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function exportProject() {
    download(`${project.name.replace(/[^\w-]/g, '_')}.openhiggs.json`, {
      ...project,
      shots: project.shots.map((s) => ({ ...s, output: outputFor(s) })),
      format: 'openhiggs-project-v1',
    });
  }
  function exportTimeline() {
    let start = 0;
    download('timeline.json', {
      version: 1,
      audio: project.soundtrack,
      name: project.name,
      fps: 24,
      width: 1920,
      height: 1080,
      clips: project.shots.map((s) => {
        const c = {
          shotId: s.id,
          name: s.name,
          source: outputFor(s) ?? null,
          start,
          duration: s.duration,
          prompt: s.prompt,
        };
        start += s.duration;
        return c;
      }),
    });
    setNotice(
      'Timeline exported. Run the included render_timeline.py to assemble clips with FFmpeg.',
    );
  }
  const active = jobs.filter((j) => ['queued', 'submitting', 'running'].includes(j.status)).length;
  return (
    <div className="oh-studio">
      <aside className="oh-rail">
        <a className="oh-mark" {...linkProps('/')} aria-label="Open Higgs home">
          h<span>✳</span>
        </a>
        <div className="oh-rail-links">
          {['◈', '▧', '⌘', '◷'].map((icon, i) => (
            <button
              title={['Canvas', 'Shots', 'Timeline', 'Sources'][i]}
              key={icon}
              className={view === ['Canvas', 'Shots', 'Timeline', 'Sources'][i] ? 'active' : ''}
              onClick={() => setView(['Canvas', 'Shots', 'Timeline', 'Sources'][i])}
            >
              {icon}
            </button>
          ))}
        </div>
        <a title="Engine setup" {...linkProps('/setup')}>
          ⚙
        </a>
      </aside>
      <aside className="oh-sidebar">
        <div className="oh-workspace">
          PERSONAL WORKSPACE<span>⌄</span>
        </div>
        <h2>
          Your studio.
          <br />
          <span>Without limits.</span>
        </h2>
        <button
          className="oh-new"
          onClick={() => {
            const p = seed();
            p.name = 'Untitled film';
            p.shots = [];
            void openProject(p);
          }}
        >
          ＋ New project
        </button>
        <div className="oh-sidebar-heading">
          PROJECTS <span>{projects.length}</span>
        </div>
        <div className="oh-projects">
          {projects.map((p) => (
            <button
              key={p.id}
              className={p.id === project.id ? 'selected' : ''}
              onClick={() => void openProject(p)}
            >
              ▱ <span>{p.name}</span>
              <small>{p.shots.length}</small>
            </button>
          ))}
        </div>
        <div className="oh-sidebar-heading">CREATIVE TOOLS</div>
        <div className="oh-tool-links">
          {[
            ['Director', '/director'],
            ['Character studio', '/cast'],
            ['Motion transfer', '/mirror'],
            ['Camera & reshoot', '/reshoot'],
            ['Plate & image edit', '/edit'],
            ['3D stage', '/stage'],
            ['Upscale & finish', '/upscale'],
          ].map(([name, to]) => (
            <a key={to} {...linkProps(to)}>
              <span>↗</span>
              {name}
            </a>
          ))}
        </div>
        <div className="oh-sidebar-bottom">
          <span className="oh-dot" /> LOCAL-FIRST STUDIO
          <small>One project. Your choice of compute.</small>
          <button onClick={() => setView('Sources')}>Built with open source ↗</button>
        </div>
      </aside>
      <section className="oh-main">
        <header className="oh-project-header">
          <div>
            <span className="oh-breadcrumb">
              Projects <b>/</b>{' '}
            </span>
            <input
              aria-label="Project name"
              value={project.name}
              onChange={(e) => update({ name: e.target.value })}
            />
            <small>
              <span className="oh-dot" />
              {saveState}
            </small>
          </div>
          <div className="oh-header-actions">
            <button onClick={() => importFile.current?.click()}>Import</button>
            <button onClick={exportProject}>Export project ↗</button>
          </div>
        </header>
        <div className="oh-toolbar">
          <div className="oh-tabs">
            {['Canvas', 'Shots', 'Queue', 'Timeline', 'Sources'].map((v) => (
              <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                {v}
              </button>
            ))}
          </div>
          <div className="oh-toolbar-right">
            <span>
              {active
                ? `${active} take${active === 1 ? '' : 's'} processing`
                : 'Make something worth watching'}
            </span>
            <button
              className="oh-queue-all"
              disabled={
                busy ||
                !ready ||
                !project.shots.some((s) => s.prompt.trim()) ||
                providers.find((p) => p.id === project.mode)?.ready === false
              }
              onClick={() => void queueShots()}
            >
              {project.mode === 'wavespeed' || project.mode === 'kie'
                ? `Queue ${queueableCount} paid takes`
                : `Queue ${queueableCount} shots`}{' '}
              ↗
            </button>
            <button onClick={addShot}>＋ Add shot</button>
          </div>
        </div>
        {view === 'Sources' ? (
          <div className="oh-source-page">
            <div className="oh-eyebrow">THE OPEN SOURCE FOUNDATION</div>
            <h1>Better, together.</h1>
            <p>Specialist tools, a shared workflow library, and one place to direct it all.</p>
            <div className="oh-source-grid">
              {sources.map((s) => (
                <article key={s.repo}>
                  <div className="oh-source-top">
                    <span>{s.license}</span>
                    <small>{s.status}</small>
                  </div>
                  <h3>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.repo.split('/')[1]} ↗
                    </a>
                  </h3>
                  <p>{s.role}</p>
                  <small>Revision {s.revision.slice(0, 8)}</small>
                  <div>
                    {s.workflows.map((w) => (
                      <button
                        key={w.id}
                        onClick={() => {
                          void loadWorkflow(w.id);
                          setView('Canvas');
                        }}
                      >
                        {w.name} ↗
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="oh-editor">
            <div className="oh-content">
              {view === 'Queue' ? (
                <StudioQueue
                  jobs={jobs.filter((j) => j.projectId === project.id)}
                  shots={project.shots}
                  onCancel={cancelQueued}
                  onRecover={recoverTake}
                  onReview={(job) => {
                    setSelected(job.shotId);
                    setProject((p) => ({
                      ...p,
                      shots: p.shots.map((s) =>
                        s.id === job.shotId ? { ...s, output: job.outputs[0] } : s,
                      ),
                    }));
                    setView('Timeline');
                  }}
                />
              ) : view === 'Canvas' ? (
                <>
                  <div className="oh-canvas-title">
                    <span className="oh-eyebrow">STORY CANVAS</span>
                    <h1>Start with a feeling.</h1>
                    <p>Connect your ideas. Direct every frame.</p>
                  </div>
                  <div
                    className="oh-board"
                    onPointerMove={move}
                    onPointerUp={() => {
                      drag.current = null;
                    }}
                    onPointerCancel={() => {
                      drag.current = null;
                    }}
                  >
                    <div className="oh-board-inner" style={{ transform: `scale(${zoom})` }}>
                      <svg className="oh-connections" width="1900" height="1000" aria-hidden>
                        {project.shots.slice(1).map((s, i) => {
                          const a = project.shots[i];
                          return (
                            <path
                              key={s.id}
                              d={`M ${a.x + 280} ${a.y + 125} C ${a.x + 340} ${a.y + 125}, ${s.x - 60} ${s.y + 125}, ${s.x} ${s.y + 125}`}
                            />
                          );
                        })}
                      </svg>
                      {project.shots.map((s, i) => (
                        <article
                          className={`oh-node ${s.id === shot?.id ? 'selected' : ''}`}
                          key={s.id}
                          style={{ left: s.x, top: s.y }}
                          onPointerDown={(e) => {
                            if ((e.target as HTMLElement).closest('video')) return;
                            setSelected(s.id);
                            e.currentTarget.setPointerCapture(e.pointerId);
                            drag.current = {
                              id: s.id,
                              x: s.x,
                              y: s.y,
                              px: e.clientX,
                              py: e.clientY,
                            };
                          }}
                        >
                          <div className="oh-node-top">
                            <span>SHOT {i + 1}</span>
                            <small>
                              {s.duration}s <b>⋮</b>
                            </small>
                          </div>
                          <Media
                            src={outputFor(s) ?? s.reference}
                            reference={!outputFor(s) && !!s.reference}
                          />
                          <div className="oh-node-caption">
                            <h3>{s.name}</h3>
                            <p>{s.prompt || 'Add a prompt to begin'}</p>
                          </div>
                          <span className="oh-port oh-in" />
                          <span className="oh-port oh-out" />
                        </article>
                      ))}
                    </div>
                  </div>
                  <div className="oh-board-footer">
                    <span>✥ Drag shots to arrange your board</span>
                    <div>
                      <button
                        aria-label="Zoom out"
                        onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
                      >
                        −
                      </button>
                      <span>{Math.round(zoom * 100)}%</span>
                      <button
                        aria-label="Zoom in"
                        onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}
                      >
                        ＋
                      </button>
                    </div>
                  </div>
                </>
              ) : view === 'Shots' ? (
                <div className="oh-shots-page">
                  <div className="oh-eyebrow">SHOT LIBRARY</div>
                  <h1>A story, frame by frame.</h1>
                  <div className="oh-shot-grid">
                    {project.shots.map((s) => (
                      <button
                        className={s.id === shot?.id ? 'selected' : ''}
                        key={s.id}
                        onClick={() => setSelected(s.id)}
                      >
                        <Media
                          src={outputFor(s) ?? s.reference}
                          reference={!outputFor(s) && !!s.reference}
                        />
                        <strong>{s.name}</strong>
                        <small>
                          {s.duration}s · {outputFor(s) ? 'Ready' : 'Awaiting generation'}
                        </small>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="oh-timeline-page">
                  <div className="oh-eyebrow">THE CUT</div>
                  <h1>Find your rhythm.</h1>
                  <div className="oh-preview">
                    <Media src={shot ? outputFor(shot) : undefined} />
                  </div>
                  <div className="oh-timeline-meta">
                    <span>
                      {project.shots.reduce((n, s) => n + s.duration, 0).toFixed(1)} seconds · 24
                      fps
                    </span>
                    <button onClick={exportTimeline}>Export timeline ↗</button>
                  </div>
                  <SoundtrackPicker
                    value={project.soundtrack}
                    onChange={(soundtrack) => update({ soundtrack })}
                    onNotice={setNotice}
                  />
                  <div className="oh-track-label">
                    PICTURE <span>Drag clips to reorder</span>
                  </div>
                  <div className="oh-track">
                    {project.shots.map((s, i) => (
                      <div
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', s.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = e.dataTransfer.getData('text/plain');
                          const shots = [...project.shots],
                            at = shots.findIndex((x) => x.id === from);
                          if (at < 0) return;
                          const [item] = shots.splice(at, 1);
                          shots.splice(i, 0, item);
                          update({ shots });
                        }}
                        onClick={() => setSelected(s.id)}
                        className={`oh-clip ${s.id === shot?.id ? 'selected' : ''}`}
                        key={s.id}
                        style={{ minWidth: Math.max(105, s.duration * 28) }}
                      >
                        <strong>{s.name}</strong>
                        <small>{s.duration}s</small>
                      </div>
                    ))}
                  </div>
                  <p className="oh-timeline-help">
                    Generated takes appear in the viewer. Export the timeline to render with the
                    included FFmpeg script. Reference previews are excluded from exports.
                  </p>
                </div>
              )}
            </div>
            <aside className="oh-inspector">
              <div className="oh-inspector-heading">
                SHOT DETAILS <span>⌘</span>
              </div>
              <div className="oh-inspector-body">
                {shot ? (
                  <>
                    <input
                      className="oh-shot-name"
                      aria-label="Shot name"
                      value={shot.name}
                      onChange={(e) => updateShot({ name: e.target.value })}
                    />
                    <label className="oh-label">
                      THE DIRECTION
                      <textarea
                        aria-label="Shot prompt"
                        value={shot.prompt}
                        onChange={(e) => updateShot({ prompt: e.target.value })}
                        placeholder="Describe the shot you can already see..."
                      />
                    </label>
                    <div className="oh-duration">
                      <label htmlFor="shot-duration">Duration</label>
                      <input
                        id="shot-duration"
                        type="number"
                        min="0.1"
                        max="120"
                        step="0.5"
                        value={shot.duration}
                        onChange={(e) =>
                          updateShot({
                            duration: Math.max(0.1, Math.min(120, Number(e.target.value) || 0.1)),
                          })
                        }
                      />
                      <small>seconds</small>
                    </div>
                    <div className="oh-separator" />
                    <div className="oh-label">RUN IT YOUR WAY</div>
                    <div className="oh-modes">
                      {(['wavespeed', 'kie', 'local', 'kaggle'] as Mode[]).map((m) => (
                        <button
                          key={m}
                          className={project.mode === m ? 'active' : ''}
                          onClick={() => changeMode(m)}
                        >
                          <span>
                            {m === 'wavespeed'
                              ? '↗'
                              : m === 'kie'
                                ? '✳'
                                : m === 'local'
                                  ? '▣'
                                  : '◈'}
                          </span>
                          {m === 'wavespeed'
                            ? 'WaveSpeed'
                            : m === 'kie'
                              ? 'Kie.ai'
                              : m === 'local'
                                ? 'Local GPU'
                                : 'Twin T4'}
                          <small>
                            {m === 'local'
                              ? 'YOUR MACHINE'
                              : m === 'kaggle'
                                ? 'KAGGLE'
                                : 'PAID API'}
                          </small>
                        </button>
                      ))}
                    </div>
                    <ComputeHealth mode={project.mode} />
                    <p className="oh-provider-detail">
                      {providers.find((p) => p.id === project.mode)?.detail}
                    </p>
                    {project.mode === 'wavespeed' || project.mode === 'kie' ? (
                      <>
                        <label className="oh-label">
                          MODEL ID
                          <input
                            aria-label="Provider model ID"
                            value={project.model}
                            onChange={(e) => update({ model: e.target.value })}
                          />
                        </label>
                        <label className="oh-label">
                          MODEL PARAMETERS
                          <textarea
                            className="oh-code"
                            aria-label="Model parameters JSON"
                            value={project.input}
                            onChange={(e) => update({ input: e.target.value })}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <label className="oh-label">
                          WORKFLOW
                          <input
                            className="oh-workflow-search"
                            aria-label="Search workflow library"
                            placeholder="Search 125 workflows…"
                            value={workflowSearch}
                            onChange={(e) => setWorkflowSearch(e.target.value)}
                          />
                          <select
                            aria-label="Workflow library"
                            value=""
                            onChange={(e) => void loadWorkflow(e.target.value)}
                          >
                            <option value="">Choose from the library</option>
                            {sources
                              .filter((s) => s.workflows.length)
                              .map((s) => (
                                <optgroup key={s.repo} label={s.repo.split('/')[1]}>
                                  {s.workflows
                                    .filter((w) =>
                                      (s.repo + ' ' + w.name)
                                        .toLowerCase()
                                        .includes(workflowSearch.toLowerCase()),
                                    )
                                    .map((w) => (
                                      <option key={w.id} value={w.id}>
                                        {w.name}
                                      </option>
                                    ))}
                                </optgroup>
                              ))}
                          </select>
                        </label>
                        {!project.workflow && (
                          <button
                            className="oh-starter"
                            onClick={() =>
                              void loadWorkflow('open-source-canvas--workflows_sd-turbo_api')
                            }
                          >
                            Start with the lightweight image workflow ↗
                          </button>
                        )}
                        <button className="oh-import" onClick={() => file.current?.click()}>
                          ↑ Import ComfyUI API JSON
                        </button>
                        <WorkflowControls
                          workflow={project.workflow}
                          mode={project.mode}
                          bindingNode={project.bindingNode}
                          bindingField={project.bindingField}
                          assets={project.workflowAssets ?? []}
                          onWorkflow={(workflow) => update({ workflow })}
                          onAssets={(workflowAssets) => update({ workflowAssets })}
                          onNotice={setNotice}
                        />
                        <button className="oh-advanced" onClick={() => setShowAdvanced((v) => !v)}>
                          {showAdvanced ? '▾' : '▸'} Workflow & prompt binding{' '}
                          {project.workflow ? '· loaded' : ''}
                        </button>
                        {showAdvanced && (
                          <>
                            <textarea
                              aria-label="Workflow JSON"
                              className="oh-code oh-graph"
                              value={project.workflow}
                              onChange={(e) => update({ workflow: e.target.value })}
                            />
                            <div className="oh-binding">
                              <label>
                                Prompt node
                                <input
                                  aria-label="Prompt node ID"
                                  value={project.bindingNode}
                                  onChange={(e) => update({ bindingNode: e.target.value })}
                                />
                              </label>
                              <label>
                                Input field
                                <input
                                  aria-label="Prompt input field"
                                  value={project.bindingField}
                                  onChange={(e) => update({ bindingField: e.target.value })}
                                />
                              </label>
                            </div>
                            <small>
                              Leave the node empty to run the graph unchanged. Check model files and
                              media filenames in the JSON.
                            </small>
                          </>
                        )}
                      </>
                    )}
                    {currentJob && (
                      <div className={`oh-job-status ${currentJob.status}`}>
                        <span className="oh-dot" />
                        {currentJob.status}
                        <small>{currentJob.error}</small>
                      </div>
                    )}
                    {completed && (
                      <div className="oh-take-save">
                        <button onClick={() => void archiveTake(completed)}>
                          {completed.archived || completed.mode === 'kaggle'
                            ? '✓ Saved to your studio'
                            : '↓ Save media locally'}
                        </button>
                        {completed.archiveError && <small>{completed.archiveError}</small>}
                      </div>
                    )}
                    {completed && (
                      <div className="oh-takes">
                        <div className="oh-label">GENERATED TAKES</div>
                        {shotJobs
                          .filter((j) => j.status === 'completed')
                          .map((j, i) => (
                            <button key={j.id} onClick={() => updateShot({ output: j.outputs[0] })}>
                              Take {shotJobs.filter((j) => j.status === 'completed').length - i}
                              <span>{j.mode} ↗</span>
                            </button>
                          ))}
                      </div>
                    )}
                    <button
                      className="oh-delete"
                      onClick={() => {
                        update({ shots: project.shots.filter((s) => s.id !== shot.id) });
                        setSelected(project.shots.find((s) => s.id !== shot.id)?.id ?? '');
                      }}
                    >
                      Remove shot
                    </button>
                  </>
                ) : (
                  <div className="oh-inspector-empty">
                    <span>✳</span>
                    <p>Your story starts with one shot.</p>
                    <button className="oh-new" onClick={addShot}>
                      ＋ Add your first shot
                    </button>
                  </div>
                )}
              </div>
              <div className="oh-inspector-footer">
                {shot && (
                  <>
                    <button
                      className="oh-generate"
                      disabled={
                        busy ||
                        !ready ||
                        !shot.prompt.trim() ||
                        providers.find((p) => p.id === project.mode)?.ready === false
                      }
                      onClick={() => void generate()}
                    >
                      {busy ? 'Submitting…' : '✳ Generate take'}
                      <span>↗</span>
                    </button>
                    <p className="oh-generation-note">
                      Every click creates one take. Paid models use your provider account.
                    </p>
                  </>
                )}
              </div>
            </aside>
          </div>
        )}
        {notice && (
          <div className="oh-notice" role="status">
            <span>{notice}</span>
            <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        <input
          ref={file}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            try {
              const f = e.target.files?.[0];
              if (!f) return;
              const raw = JSON.parse(await f.text());
              if (raw.nodes)
                throw new Error('Use ComfyUI Save (API Format), not the visual editor format.');
              update({ workflow: JSON.stringify(raw, null, 2) });
              setShowAdvanced(true);
              setNotice('Workflow imported. Set the prompt binding and check model paths.');
            } catch (err) {
              setNotice((err as Error).message);
            }
            e.target.value = '';
          }}
        />
        <input
          ref={importFile}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            try {
              const f = e.target.files?.[0];
              if (!f) return;
              const p = JSON.parse(await f.text());
              if (
                p.format !== 'openhiggs-project-v1' ||
                !Array.isArray(p.shots) ||
                typeof p.name !== 'string' ||
                !['local', 'kaggle', 'kie', 'wavespeed'].includes(p.mode)
              )
                throw new Error('Choose an Open Higgs project export.');
              const imported = {
                ...p,
                id: uid(),
                shots: p.shots.map((s: any) => ({ ...s, id: uid() })),
              };
              await openProject(imported);
            } catch (err) {
              setNotice((err as Error).message);
            }
            e.target.value = '';
          }}
        />
      </section>
    </div>
  );
}
