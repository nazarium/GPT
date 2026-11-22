import { useEffect, useRef, useState } from 'react';
import { Portfolio } from './Portfolio.jsx';
import { ProjectPage } from './ProjectPage.jsx';
import { Contact } from './Contact.jsx';
import { Hero } from './Hero.jsx';
import { defaultStudioDetails } from './home-text-fields.mjs';
import { articleCoverLayout } from './article-layout.mjs';

function Logo({ home, prefix }) {
  return <a href={home ? '#' : prefix + 'index.html'} className="logo" aria-label="Archi-Create — головна">
    <img src={prefix + 'assets/logo-original.png'} alt="" width="1921" height="1081" />
    <span className="brand-name">ARCHI-CREATE</span>
  </a>;
}

function Header({ home, prefix, blog }) {
  const [open, setOpen] = useState(false);
  const anchor = id => (home ? '' : prefix + 'index.html') + '#' + id;
  return <header className={home ? 'header header-home' : 'header'}>
    <Logo home={home} prefix={prefix} />
    <button type="button" className="menu-toggle" aria-expanded={open} aria-controls="navigation" onClick={() => setOpen(value => !value)}>Меню <span>＋</span></button>
    <nav id="navigation" className={open ? 'open' : undefined} aria-label="Головна навігація" onClick={() => setOpen(false)}>
      <a href={anchor('projects')}>Проєкти</a>
      <a href={anchor('studio')}>Студія</a>
      <a href={anchor('approach')}>Підхід</a>
      <a href={prefix + 'blog.html'} aria-current={blog ? 'page' : undefined}>Блог</a>
      <a href={anchor('contact')} className="nav-contact">Поговорімо <span>↗</span></a>
    </nav>
  </header>;
}

function Footer({ home, prefix, buildYear }) {
  const [year, setYear] = useState(buildYear);
  useEffect(() => setYear(new Date().getFullYear()), []);
  return <footer>
    <Logo home={home} prefix={prefix} />
    <span>© <span id="year">{year}</span> Archi-Create</span>
    <div className="footer-legal" aria-label="Правова інформація" role="navigation">
      <a href={prefix + 'terms.html'}>Умови використання</a>
      <a href={prefix + 'privacy-policy.html'}>Політика конфіденційності</a>
    </div>
    <a href="#" className="back-top">Нагору ↑</a>
  </footer>;
}

function Home({ page }) {
  const {
    studioProjects = defaultStudioDetails.studioProjects,
    studioYears = defaultStudioDetails.studioYears,
    studioPhoto = defaultStudioDetails.studioPhoto,
  } = page;
  return <main>
    <Hero slides={page.heroSlides} timing={page.heroTiming} />
    <Portfolio heading={page.portfolioHeading} initialCatalog={page.projects} pageSize={page.projectCount} />
    <section id="studio" className="studio section">
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: page.studio }} />
      <img className="studio-panorama" src={'/' + studioPhoto} alt="Архітектурний проєкт Archi-Create" loading="lazy" />
      <dl className="studio-facts">
        <div><dt>Реалізованих об’єктів</dt><dd>{studioProjects}</dd></div>
        <div><dt>Років практики</dt><dd>{studioYears}</dd></div>
      </dl>
    </section>
    <section id="approach" className="approach section" dangerouslySetInnerHTML={{ __html: page.approach }} />
    <section id="blog" className="blog-preview section" dangerouslySetInnerHTML={{ __html: page.blog }} />
    <Contact heading={page.contactHeading} intro={page.contactIntro} contacts={page.contacts} contactBot={page.contactBot} />
  </main>;
}

export function App({ page }) {
  const home = page.kind === 'home';
  const prefix = page.preview || page.kind === 'project' || page.kind === 'article' ? '/' : '';
  return <>
    <Header home={home} prefix={prefix} blog={page.kind === 'blog' || page.kind === 'article'} />
    {page.preview && <aside className="preview-notice" aria-label="Попередній перегляд">
      <span>Попередній перегляд · {page.trashed ? 'У кошику' : page.hidden ? 'Приховано' : page.hasDraft ? 'Чернетка' : 'Опублікована версія'}</span>
      <a className="text-link" target="_top" href={'/admin?section=' + (page.kind === 'article' ? 'articles' : 'projects')}>До редактора</a>
    </aside>}
    {home ? <Home page={page} /> : page.kind === 'project' ? <ProjectPage project={page.project} />
      : <main dangerouslySetInnerHTML={{ __html: page.kind === 'article' ? articleCoverLayout(page.body) : page.body }} />}
    <Footer home={home} prefix={prefix} buildYear={page.buildYear} />
  </>;
}
