type SectionPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  items: string[];
};

export function SectionPage({ eyebrow, title, description, items }: SectionPageProps) {
  return (
    <section className="dashboard">
      <div className="hero-card">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="page-description">{description}</p>
        </div>
        <button className="button button-secondary" type="button">
          View overview
        </button>
      </div>

      <div className="content-grid">
        <article className="panel">
          <h3>Workspace focus</h3>
          <ul className="list">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h3>Layout readiness</h3>
          <p>
            This page is wired into the shared dashboard shell and can grow into a full production
            module without changing the surrounding navigation structure.
          </p>
        </article>
      </div>
    </section>
  );
}
