type Props = { title: string; text: string };

export default function EmptyState({ title, text }: Props) {
  return (
    <div className="container-x section-pad" style={{ textAlign: 'center' }}>
      <h2 className="text-h2">{title}</h2>
      <p className="text-muted" style={{ marginTop: 12 }}>{text}</p>
    </div>
  );
}
