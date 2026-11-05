import { useState } from 'react';
import './studio-queue.css';

export type QueueJob = {
  id: string;
  projectId: string;
  shotId: string;
  mode: string;
  status: string;
  created: number;
  outputs: string[];
  error?: string;
  remoteId?: string;
};

export default function StudioQueue({
  jobs,
  shots,
  onCancel,
  onRecover,
  onReview,
}: {
  jobs: QueueJob[];
  shots: { id: string; name: string }[];
  onCancel: (job: QueueJob) => Promise<void>;
  onRecover: (job: QueueJob, remoteId: string) => Promise<void>;
  onReview: (job: QueueJob) => void;
}) {
  const [ids, setIds] = useState<Record<string, string>>({});
  const [pending, setPending] = useState('');
  const states = [
    { label: 'Waiting', matches: ['queued'] },
    { label: 'Processing', matches: ['running', 'submitting'] },
    { label: 'Ready', matches: ['completed'] },
    { label: 'Needs attention', matches: ['unknown', 'failed', 'interrupted'] },
  ];
  async function action(id: string, run: () => Promise<void>) {
    setPending(id);
    try {
      await run();
    } finally {
      setPending('');
    }
  }
  return (
    <div className="oh-queue-page">
      <div className="oh-eyebrow">RENDER QUEUE</div>
      <h1>Keep every take in view.</h1>
      <p>
        One local render or two requests per paid provider can run at a time. Kaggle workers claim
        their own jobs.
      </p>
      <div className="oh-queue-stats">
        {states.map((state) => (
          <div key={state.label}>
            <strong>{jobs.filter((job) => state.matches.includes(job.status)).length}</strong>
            <span>{state.label}</span>
          </div>
        ))}
      </div>
      {!jobs.length && (
        <div className="oh-queue-empty">
          Your queue is clear. Generate one take, or queue your shots together.
        </div>
      )}
      <div className="oh-queue-list">
        {jobs.map((job) => (
          <article key={job.id} className={`oh-queue-row ${job.status}`}>
            <div className="oh-queue-row-top">
              <div>
                <h3>{shots.find((shot) => shot.id === job.shotId)?.name ?? 'Removed shot'}</h3>
                <small>
                  {job.mode} ·{' '}
                  {new Date(job.created).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </small>
              </div>
              <span className="oh-queue-status">{job.status}</span>
              {job.status === 'queued' && (
                <button
                  disabled={pending === job.id}
                  onClick={() => void action(job.id, () => onCancel(job))}
                >
                  Cancel waiting take
                </button>
              )}
              {job.status === 'completed' && (
                <button onClick={() => onReview(job)}>Review take ↗</button>
              )}
            </div>
            {job.error && <p className="oh-queue-error">{job.error}</p>}
            {job.remoteId && <small className="oh-task-id">Task: {job.remoteId}</small>}
            {job.status === 'unknown' && (
              <div className="oh-task-recovery">
                <p>
                  Find the accepted task in your provider or ComfyUI history, then resume tracking
                  it here.
                </p>
                <label>
                  Task ID
                  <input
                    aria-label={`Recover task for ${job.id}`}
                    value={ids[job.id] ?? ''}
                    onChange={(event) =>
                      setIds((value) => ({ ...value, [job.id]: event.target.value }))
                    }
                    placeholder="Paste the existing task ID"
                  />
                </label>
                <button
                  disabled={!ids[job.id]?.trim() || pending === job.id}
                  onClick={() => void action(job.id, () => onRecover(job, ids[job.id].trim()))}
                >
                  Resume tracking
                </button>
                <small>This checks an existing task. It does not submit a new generation.</small>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
