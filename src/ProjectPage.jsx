import { useState } from 'react';

export function ProjectPage({ project }) {
  const [photo, setPhoto] = useState(0);
  const { images } = project;

  function step(direction) {
    setPhoto(index => (index + direction + images.length) % images.length);
  }
  return <main className="project-page section">
    <a className="text-link" href="/#projects">← До портфоліо</a>
    <h1>{project.title}</h1>
    <p className="project-page-label">{project.label}</p>
    {images.length ? <section className="project-page-gallery" aria-label="Фотографії проєкту">
      <div className="project-page-stage">
        <img className="project-page-active" src={images[photo]} alt={project.title + ' — фото ' + (photo + 1)} />
        <a className="project-page-close" href="/#projects" aria-label="До портфоліо" title="До портфоліо">
          <span aria-hidden="true">×</span>
        </a>
        {images.length > 1 && <>
          <button className="project-page-arrow previous" type="button" aria-label="Попереднє фото" onClick={() => step(-1)}>←</button>
          <button className="project-page-arrow next" type="button" aria-label="Наступне фото" onClick={() => step(1)}>→</button>
        </>}
      </div>
      <div className="project-page-photos" role="group" aria-label="Мініатюри фотографій">
        {images.map((image, index) => <button key={image + index} type="button" aria-pressed={photo === index}
          aria-label={'Показати фото ' + (index + 1)} onClick={() => setPhoto(index)}>
          <img src={image} alt="" loading="lazy" />
        </button>)}
      </div>
    </section> : <p>Додайте фото галереї, щоб переглянути проєкт.</p>}
    {project.description && <p className="project-description">{project.description}</p>}
    <a className="contact-action" href="/#contact">Обговорити свій проєкт ↗</a>
  </main>;
}
