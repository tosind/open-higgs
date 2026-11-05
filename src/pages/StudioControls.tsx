import { useEffect, useMemo, useState } from 'react';
import './studio-controls.css';

export type WorkflowAsset = { id: string; name: string; url: string; node: string; field: string };
export type Soundtrack = { source: string; name: string; gain: number };
export async function uploadMedia(file: File) {
  if (file.size > 45_000_000) throw new Error('Choose a file smaller than 45 MB.');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
  const response = await fetch('/api/studio/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, base64 }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result as { id: string; name: string; url: string };
}
export function ComputeHealth({ mode }: { mode: string }) {
  const [health, setHealth] = useState<any>();
  useEffect(() => {
    let active = true;
    const refresh = () =>
      fetch('/api/studio/health')
        .then((r) => r.json())
        .then((h) => {
          if (active) setHealth(h);
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  if (mode !== 'local' && mode !== 'kaggle') return null;
  const online =
    mode === 'local' ? health?.local.online : health?.workers.filter((w: any) => w.online).length;
  return (
    <div className={`oh-health ${online ? 'online' : 'offline'}`}>
      <span className="oh-dot" />
      {!health
        ? 'Checking compute…'
        : mode === 'local'
          ? online
            ? 'Local GPU connected'
            : 'Local GPU offline'
          : `${online ?? 0} Kaggle worker${online === 1 ? '' : 's'} connected`}
      {mode === 'local' && health?.local.devices?.[0] && (
        <small>
          {health.local.devices[0].name} · {(health.local.devices[0].vramFree / 2 ** 30).toFixed(1)}{' '}
          GB free
        </small>
      )}
      {mode === 'kaggle' && (
        <small>
          {online
            ? 'Independent shots can use both workers.'
            : 'Open the twin T4 notebook to connect your GPUs.'}
        </small>
      )}
    </div>
  );
}
export function WorkflowControls({
  workflow,
  mode,
  bindingNode,
  bindingField,
  assets,
  onWorkflow,
  onAssets,
  onNotice,
}: {
  workflow: string;
  mode: string;
  bindingNode: string;
  bindingField: string;
  assets: WorkflowAsset[];
  onWorkflow: (value: string) => void;
  onAssets: (value: WorkflowAsset[]) => void;
  onNotice: (message: string) => void;
}) {
  const [checked, setChecked] = useState<any>(),
    [checking, setChecking] = useState(false),
    [uploading, setUploading] = useState('');
  const graph = useMemo(() => {
    try {
      return JSON.parse(workflow);
    } catch {
      return null;
    }
  }, [workflow]);
  const groups = useMemo(() => {
    if (!graph) return [];
    return Object.entries(graph)
      .map(([node, n]: [string, any]) => ({
        node,
        title: n._meta?.title ?? n.class_type,
        fields: Object.entries(n.inputs ?? {})
          .filter(
            ([field, value]) =>
              !(node === bindingNode && field === bindingField) &&
              ['string', 'number', 'boolean'].includes(typeof value) &&
              !(typeof value === 'string' && value.length > 1500) &&
              !['filename_prefix', 'system_prompt'].includes(field),
          )
          .map(([field, value]) => ({
            field,
            value,
            options: checked?.fields?.find((f: any) => f.node === node && f.field === field)
              ?.options as string[] | undefined,
          })),
      }))
      .filter((g) => g.fields.length);
  }, [graph, bindingNode, bindingField, checked]);
  if (!graph) return null;
  function change(node: string, field: string, value: unknown) {
    const copy = structuredClone(graph);
    copy[node].inputs[field] = value;
    onWorkflow(JSON.stringify(copy, null, 2));
    setChecked((c: any) =>
      c
        ? {
            ...c,
            ready: false,
            invalidValues: [],
            note: 'Settings changed. Check setup again before rendering.',
          }
        : undefined,
    );
  }
  async function preflight() {
    setChecking(true);
    try {
      const r = await fetch('/api/studio/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: graph, mode, assets }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setChecked(result);
    } catch (e) {
      onNotice((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="oh-workflow-controls">
      <div className="oh-controls-top">
        <span>WORKFLOW INPUTS</span>
        <button onClick={() => void preflight()} disabled={checking}>
          {checking ? 'Checking…' : 'Check setup ↗'}
        </button>
      </div>
      {checked && (
        <div className={`oh-preflight ${checked.ready ? 'ready' : ''}`}>
          <strong>
            {checked.ready
              ? 'Ready to render'
              : checked.scope === 'structure'
                ? 'Structure checked'
                : 'Setup needs attention'}
          </strong>
          <p>{checked.note}</p>
          {checked.missingNodes?.length > 0 && (
            <p>Install nodes: {checked.missingNodes.join(', ')}</p>
          )}
          {checked.invalidValues?.map((v: any) => (
            <p key={v.node + v.field}>
              Node {v.node}: {v.field.replace(/_/g, ' ')} “{String(v.value)}” is unavailable. Choose
              an installed value below.
            </p>
          ))}
          {checked.brokenLinks?.map((v: string) => (
            <p key={v}>{v}</p>
          ))}
        </div>
      )}
      <div className="oh-workflow-groups">
        {groups.map((g, i) => (
          <details key={g.node} open={i === 0}>
            <summary>
              {g.title}
              <small>{g.node}</small>
            </summary>
            {g.fields.map(({ field, value, options }) => {
              const asset = assets.find((a) => a.node === g.node && a.field === field),
                isMedia =
                  /^(image|video|audio|mask|image_path|video_path|audio_path)$/.test(field) &&
                  typeof value === 'string';
              return (
                <div className="oh-workflow-field" key={field}>
                  <span>{field.replace(/_/g, ' ')}</span>
                  {typeof value === 'boolean' ? (
                    <input
                      aria-label={`${g.title} ${field}`}
                      type="checkbox"
                      checked={value}
                      onChange={(e) => change(g.node, field, e.target.checked)}
                    />
                  ) : options?.length ? (
                    <select
                      aria-label={`${g.title} ${field}`}
                      value={String(value)}
                      onChange={(e) => change(g.node, field, e.target.value)}
                    >
                      {!options.includes(String(value)) && (
                        <option value={String(value)}>{String(value)} (not installed)</option>
                      )}
                      {options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : typeof value === 'number' ? (
                    <input
                      aria-label={`${g.title} ${field}`}
                      type="number"
                      step="any"
                      value={value}
                      onChange={(e) => {
                        if (e.target.value !== '') change(g.node, field, Number(e.target.value));
                      }}
                    />
                  ) : String(value).length > 90 ? (
                    <textarea
                      aria-label={`${g.title} ${field}`}
                      value={String(value)}
                      onChange={(e) => change(g.node, field, e.target.value)}
                    />
                  ) : (
                    <input
                      aria-label={`${g.title} ${field}`}
                      value={String(value)}
                      onChange={(e) => change(g.node, field, e.target.value)}
                    />
                  )}
                  {isMedia && (
                    <div className="oh-media-upload">
                      <label className="oh-upload-button">
                        {uploading === g.node + field
                          ? 'Uploading…'
                          : asset
                            ? `✓ ${asset.name}`
                            : '↑ Upload media'}
                        <input
                          type="file"
                          disabled={!!uploading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setUploading(g.node + field);
                            try {
                              const uploaded = await uploadMedia(file);
                              onAssets([
                                ...assets.filter((a) => !(a.node === g.node && a.field === field)),
                                { ...uploaded, node: g.node, field },
                              ]);
                              onNotice(
                                'Media saved. It will transfer to the selected GPU when this shot runs.',
                              );
                            } catch (error) {
                              onNotice((error as Error).message);
                            } finally {
                              setUploading('');
                            }
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {asset && (
                        <button onClick={() => onAssets(assets.filter((a) => a !== asset))}>
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </details>
        ))}
      </div>
    </div>
  );
}
export function SoundtrackPicker({
  value,
  onChange,
  onNotice,
}: {
  value?: Soundtrack;
  onChange: (value: Soundtrack | undefined) => void;
  onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="oh-soundtrack">
      <div>
        <span>SOUNDTRACK</span>
        {value && <button onClick={() => onChange(undefined)}>Remove</button>}
      </div>
      {value ? (
        <>
          <strong>♫ {value.name}</strong>
          <audio src={value.source} controls />
          <label>
            Volume{' '}
            <input
              aria-label="Soundtrack volume"
              type="range"
              min="0"
              max="1.5"
              step=".05"
              value={value.gain}
              onChange={(e) => onChange({ ...value, gain: Number(e.target.value) })}
            />
            <small>{Math.round(value.gain * 100)}%</small>
          </label>
        </>
      ) : (
        <label className="oh-upload-button">
          {busy ? 'Uploading soundtrack…' : '♫ Add a soundtrack'}
          <input
            type="file"
            accept="audio/wav,audio/mpeg,audio/flac,.wav,.mp3,.flac"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                const asset = await uploadMedia(file);
                onChange({ source: asset.url, name: asset.name, gain: 1 });
              } catch (error) {
                onNotice((error as Error).message);
              } finally {
                setBusy(false);
              }
              e.target.value = '';
            }}
          />
        </label>
      )}
      <small>Your soundtrack is included in the rendered film.</small>
    </div>
  );
}
