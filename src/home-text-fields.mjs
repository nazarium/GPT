export const contactSymbols = [
  '↗', '→', '↑', '➜', '➤', '⟶', '✦', '＋',
  '↘', '↓', '↙', '←', '↖', '↔', '↕', '⇒',
  '⇢', '➔', '✧', '✳', '⇗', '⇧', '⇨', '⇩',
  '⇦', '⇖', '⇘', '⇙', '⇄', '⇆', '⇅', '⇵',
  '⇈', '⇊', '⤴', '⤵', '↪', '↩', '↬', '↫',
  '✴', '✶', '✷', '✸', '✹', '✺', '✻', '✼',
];
export const defaultContactSymbol = '↗';

export const defaultSectionLabels = { studioLabel: 'ПРО СТУДІЮ', approachLabel: 'ПІДХІД' };

export const defaultContactTexts = {
  contactIntro: 'Розкажіть про свій задум.\nОбговоримо ваш майбутній простір.',
};

export const defaultApproachTexts = {
  approachTitle: 'Від розмови\nдо',
  approachAccent: 'простору.',
  approachAside: 'Чітка послідовність.\nСпільне бачення.',
};

export const defaultStudioDetails = {
  studioProjects: '400+',
  studioYears: '18',
  studioPhoto: 'assets/hero-panorama.jpg',
};

export const studioNumberPatterns = {
  studioProjects: '[0-9]+\\+?',
  studioYears: '[0-9]+',
};

export const textGroups = [
  { title: 'Про студію', photo: true, fields: [
    ['studioLabel', 'Назва розділу «Про студію»', 80],
    ['studioTitle', 'Заголовок', 100],
    ['studioAccent', 'Акцентний рядок', 100],
    ['studioIntro', 'Вступ', 500, 2],
    ['studioDescription', 'Опис студії (необов’язково)', 1200, 4, false],
    ['studioProjects', 'Кількість реалізованих об’єктів', 12],
    ['studioYears', 'Роки практики', 4],
  ] },
  { title: 'Підхід', fields: [
    ['approachLabel', 'Назва розділу «Підхід»', 80],
    ['approachTitle', 'Заголовок підходу', 100, 2],
    ['approachAccent', 'Акцентний текст підходу', 100],
    ['approachAside', 'Підпис підходу', 300, 3],
    ...Array.from({ length: 4 }, (_, index) => [
    ['stepTitle' + index, 'Назва етапу ' + (index + 1), 80],
    ['stepDescription' + index, 'Опис етапу ' + (index + 1), 500, 2],
  ]).flat()] },
  { title: 'Почнімо з розмови', fields: [
    ['contactLabel', 'Назва блоку', 80],
    ['contactTitle', 'Заголовок', 100],
    ['contactAccent', 'Акцентний рядок', 100],
    ['contactIntro', 'Текст запрошення до розмови', 500, 3],
  ] },
];
