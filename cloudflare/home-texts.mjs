import home from '../content/index.json';
import { escapeHtml } from '../src/article-text.mjs';
import { contactSymbols, defaultContactSymbol, defaultSectionLabels, defaultContactTexts, defaultApproachTexts, defaultStudioDetails } from '../src/home-text-fields.mjs';

const heading = /<h2>(.*?)<br><em>(.*?)<\/em><\/h2>/;
const studioCopy = /(<div class="studio-copy">)<p>(.*?)<\/p>/;
const retiredStudioDescription = 'Ми пропонуємо варіанти й пояснюємо, як кожен вплине на планування, освітлення та вигляд будівлі. Так рішення можна зважити ще до початку будівництва.';
const step = /(<article><span class="step-number">\d+<\/span>)<h3>(.*?)<\/h3><p>(.*?)<\/p><\/article>/g;
const contactLabel = /<p class="eyebrow">05 \/ (.*?)<\/p>/;

export function originalHomeTexts() {
  const [, studioTitle, studioAccent] = home.studio.match(heading);
  const [, , studioIntro] = home.studio.match(studioCopy);
  const [, contactTitle, contactAccent] = home.contactHeading.match(heading);
  const [, label] = home.contactHeading.match(contactLabel);
  const texts = { ...defaultStudioDetails, ...defaultSectionLabels, ...defaultApproachTexts, ...defaultContactTexts, studioTitle, studioAccent, studioIntro, studioDescription: '',
    contactTitle, contactAccent, contactSymbol: defaultContactSymbol, contactLabel: label };
  [...home.approach.matchAll(step)].forEach(([, , title, description], index) => {
    texts['stepTitle' + index] = title;
    texts['stepDescription' + index] = description;
  });
  return texts;
}

export function currentHomeTexts(texts) {
  const description = texts.studioDescription?.trim();
  const photo = texts.studioPhoto === 'assets/studio-nazar.jpg' ? defaultStudioDetails.studioPhoto : texts.studioPhoto;
  return { ...defaultStudioDetails, ...defaultSectionLabels, ...defaultApproachTexts, ...defaultContactTexts, ...texts, contactSymbol: contactSymbols.includes(texts.contactSymbol) ? texts.contactSymbol : defaultContactSymbol, studioPhoto: photo ?? defaultStudioDetails.studioPhoto,
    studioDescription: description === retiredStudioDescription ? '' : description ?? '' };
}

export function renderHomeTexts(texts) {
  texts = currentHomeTexts(texts);
  const text = key => escapeHtml(texts[key]).replace(/\r?\n/g, '<br>');
  const title = (main, accent) => '<h2>' + text(main) + '<br><em>' + text(accent) + '</em></h2>';
  let index = 0;
  return {
    contactIntro: texts.contactIntro,
    studioProjects: texts.studioProjects,
    studioYears: texts.studioYears,
    studioPhoto: texts.studioPhoto,
    studio: home.studio.replace(/<p class="eyebrow">02 \/ .*?<\/p>/s, () => '<p class="eyebrow">02 / ' + text('studioLabel') + '</p>')
      .replace(heading, () => title('studioTitle', 'studioAccent'))
      .replace(studioCopy, (_, start) => start + '<p>' + text('studioIntro') + '</p>'
        + (texts.studioDescription ? '<p class="muted">' + text('studioDescription') + '</p>' : '')),
    approach: home.approach
      .replace(/<p class="eyebrow">03 \/ .*?<\/p>/s, () => '<p class="eyebrow">03 / ' + text('approachLabel') + '</p>')
      .replace(/<h2>.*?<\/h2>/s, () => '<h2>' + text('approachTitle') + ' <em>' + text('approachAccent') + '</em></h2>')
      .replace(/<p class="section-aside">.*?<\/p>/s, () => '<p class="section-aside">' + text('approachAside') + '</p>')
      .replace(step, (_, start) => {
      const current = index++;
      return start + '<h3>' + text('stepTitle' + current) + '</h3><p>' + text('stepDescription' + current) + '</p></article>';
    }),
    contactHeading: home.contactHeading.replace(contactLabel, () => '<p class="eyebrow">05 / ' + text('contactLabel') + '</p>')
      .replace(heading, () => title('contactTitle', 'contactAccent'))
      .replace(/(<span class="contact-arrow" aria-hidden="true">).*?(<\/span>)/, (_, start, end) => start + text('contactSymbol') + end),
  };
}
