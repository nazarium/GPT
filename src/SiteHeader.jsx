import {useEffect,useRef,useState} from 'react';

export function SiteHeader({logo,home,prefix,blog}) {
  const [open,setOpen]=useState(false);
  const [scrolled,setScrolled]=useState(false);
  const [active,setActive]=useState(home?null:blog?'blog':null);
  useEffect(()=>{
    let frame;
    const update=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        setScrolled(window.scrollY>64);
        if(!home)return;
        const ids=['projects','studio','approach','blog','contact'];
        const section=ids.findLast(id=>{const element=document.getElementById(id);return element&&element.getBoundingClientRect().top<=150;});
        const atBottom=window.scrollY>64&&window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-3;
        setActive(atBottom?'contact':section??null);
      });
    };
    update();
    window.addEventListener('scroll',update,{passive:true});
    return ()=>{window.removeEventListener('scroll',update);cancelAnimationFrame(frame);};
  },[home]);
  const root=useRef(null),toggle=useRef(null);
  const [highlight,setHighlight]=useState(null);
  useEffect(()=>{
    const header=root.current;
    let frame;
    const measure=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const link=[...header.querySelectorAll('[data-nav-section]')].find(el=>el.dataset.navSection===active&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0);
        if(!link){setHighlight(null);return;}
        const box=link.getBoundingClientRect(),container=header.getBoundingClientRect();
        setHighlight({left:box.left-container.left,top:box.top-container.top,width:box.width,height:box.height});
      });
    };
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(header);
    header.querySelectorAll('.primary-navigation,[data-nav-section]').forEach(el=>observer.observe(el));
    window.addEventListener('resize',measure);
    document.fonts?.ready.then(measure);
    return ()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',measure);};
  },[active,open,scrolled]);
  const anchor=id=>(home?'':'/')+'#'+id;
  const close=()=>setOpen(false);
  useEffect(()=>{
    const outside=event=>{if(!root.current?.contains(event.target))close();};
    const escape=event=>{if(event.key!=='Escape')return;
      if(open){setOpen(false);toggle.current?.focus();}
    };
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  return <header ref={root} className={'header site-header header-minimal'+(home?' header-home':'')+(scrolled?' is-scrolled':'')}>
    <span className="site-slide-highlight" aria-hidden="true" style={{width:highlight?.width??0,height:highlight?.height??0,transform:highlight?'translate3d('+highlight.left+'px,'+highlight.top+'px,0)':undefined,opacity:highlight?1:0}}/>
    <div className="site-header-brand" onClick={close}>{logo}</div>
    <button ref={toggle} className="site-menu-toggle" type="button" aria-expanded={open} aria-controls="navigation" onClick={()=>{setOpen(!open);}}>
      <span>{open?'Закрити':'Меню'}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={open?'m6 6 12 12M6 18 18 6':'M4 8h16M4 16h16'}/></svg>
    </button>
    <nav id="navigation" className={'primary-navigation'+(open?' is-open':'')} aria-label="Головна навігація">
      <a className="site-nav-link" href={anchor('projects')} data-nav-section="projects" aria-current={active==='projects'?'location':undefined} onClick={close}>Проєкти</a>
      <a className="site-nav-link" href={anchor('studio')} data-nav-section="studio" aria-current={active==='studio'?'location':undefined} onClick={close}>Студія</a>
      <a className="site-nav-link" href={anchor('approach')} data-nav-section="approach" aria-current={active==='approach'?'location':undefined} onClick={close}>Підхід</a>
      <a className="site-nav-link" href={anchor('blog')} data-nav-section="blog" aria-current={active==='blog'?'location':undefined} onClick={close}>Блог</a>
      <a className="site-nav-link site-mobile-contact" href={anchor('contact')} data-nav-section="contact" aria-current={active==='contact'?'location':undefined} onClick={close}>Контакти</a>
    </nav>
    <a className="nav-contact site-desktop-contact" href={anchor('contact')} data-nav-section="contact" aria-current={active==='contact'?'location':undefined}>Контакти <span aria-hidden="true">↗</span></a>
  </header>;
}
