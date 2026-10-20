type Props = { title: string; text: string };

export default function AdminEmpty({ title, text }: Props) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 24 }}>
      <h1 className="text-h2">{title}</h1>
      <p className="text-muted" style={{ marginTop: 12 }}>{text}</p>
    </div>
  );
}
