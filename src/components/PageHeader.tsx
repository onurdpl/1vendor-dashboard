type PageHeaderProps = {
  title: string;
  description: string;
};

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">Operational workspace</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      <div className="header-badge">Phase 16A foundation</div>
    </header>
  );
}
