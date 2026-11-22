import { useEffect, useState } from 'react';
import projects from '../content/projects.json';
import { Gallery } from './Gallery.jsx';
import { projectCategories } from './project-categories.mjs';
import { defaultProjectCount } from './home-display.mjs';

const categories = {
  all: 'Усі',
  ...projectCategories,
};

export function ProjectCard({ project, offset, onOpen }) {
  return <button type="button" className={offset ? 'project offset' : 'project'}
    data-category={project.category} data-project={project.id}
    aria-label={project.title + ' — проєкт ' + project.number} onClick={() => onOpen(project)}>
    <span className="project-photo">
      <img src={project.cover} alt={project.title + ' — Archi-Create'} loading="lazy" width="808" height="632" />
      <span className="project-open" aria-hidden="true">↗</span>
    </span>
    <span className="project-title">{project.title} <span>{project.number}</span></span>
    <span className="project-meta">{project.label} <span>{project.images.length} зобр.</span></span>
  </button>;
}

export function Portfolio({ heading, initialCatalog, pageSize = defaultProjectCount }) {
  const [category, setCategory] = useState('all');
  const [limit, setLimit] = useState(pageSize);
  const [project, setProject] = useState(null);
  const [catalog, setCatalog] = useState(initialCatalog ?? projects);
  useEffect(() => {
    const local = document.querySelector('meta[name="archi-local-admin"]');
    const cloud = document.querySelector('meta[name="archi-cloud-admin"]');
    if (!local && (!cloud || initialCatalog)) return;
    fetch(local ? '/__local/projects' : '/api/projects')
      .then(response => { if (!response.ok) throw new Error('Portfolio unavailable'); return response.json(); })
      .then(setCatalog).catch(console.error);
  }, [initialCatalog]);
  const byCategory = Object.fromEntries(Object.keys(categories).map(key => [
    key, catalog.filter(item => key === 'all' || item.category === key),
  ]));
  const matches = byCategory[category];
  const visible = matches.slice(0, limit);

  return <section id="projects" className="projects section">
    <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: heading }} />
    <div className="portfolio-toolbar">
      <div className="filters" role="group" aria-label="Категорії проєктів">
        {Object.entries(categories).map(([key, label]) =>
          <button key={key} type="button" data-filter={key} className={key === category ? 'active' : undefined}
            aria-pressed={key === category} onClick={() => { setCategory(key); setLimit(pageSize); }}>
            {label} <sup>{byCategory[key].length}</sup>
          </button>)}
      </div>
      <a className="portfolio-source" href="https://www.behance.net/archi-create" target="_blank" rel="noopener noreferrer">Наш Behance ↗</a>
    </div>
    <div className="project-grid">
      {visible.map((item, index) => <ProjectCard key={item.id} project={item} offset={index % 2 === 1} onOpen={setProject} />)}
    </div>
    <div className="portfolio-bottom">
      <p id="portfolio-count" aria-live="polite">Показано {visible.length} із {matches.length} проєктів</p>
      <button type="button" id="load-more" className="load-more" hidden={limit >= matches.length}
        onClick={() => setLimit(value => value + pageSize)}>
        Показати ще {Math.min(pageSize, Math.max(0, matches.length - limit))} <span aria-hidden="true">＋</span>
      </button>
    </div>
    {project && <Gallery key={project.id} project={project} onClose={() => setProject(null)} />}
  </section>;
}
