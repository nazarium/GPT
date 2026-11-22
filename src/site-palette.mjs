export const paletteFields = {
  paper: 'Фон сторінок',
  ink: 'Основний текст',
  muted: 'Другорядний текст',
  accent: 'Акцентний колір',
  surface: 'Фон кнопок і полів',
};

export const defaultPalette = {
  paper: '#272727',
  ink: '#ffffff',
  muted: '#b8b8b8',
  accent: '#dd4425',
  surface: '#353535',
};

export function contrastRatio(first, second) {
  const luminance = hex => [1, 3, 5].reduce((sum, offset, index) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  const levels = [luminance(first), luminance(second)];
  return (Math.max(...levels) + 0.05) / (Math.min(...levels) + 0.05);
}
