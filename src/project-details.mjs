const translatedTitles = {
  "Residential House": "Індивідуальний житловий будинок",
  "Residential House (renovation)": "Індивідуальний житловий будинок (реконструкція)",
  "Wooden Residential House": "Дерев’яний індивідуальний житловий будинок",
  "Residential House (duplex)": "Індивідуальний житловий будинок (дуплекс)",
  "Duplex, TwinHouses": "Дуплекс — зблоковані житлові будинки",
  "residential house": "Індивідуальний житловий будинок",
  "Shopping Center": "Торговельний центр",
  "Residential house": "Індивідуальний житловий будинок",
  "residental house": "Індивідуальний житловий будинок",
  "warehouse": "Склад",
  "house": "Житловий будинок",
  "modern home": "Сучасний житловий будинок",
  "Home": "Житловий будинок",
  "garden house": "Садовий будинок",
  "Residential apartment building": "Багатоквартирний житловий будинок",
  "Logistics center": "Логістичний центр",
  "Guest house (reconstruction)": "Гостьовий будинок (реконструкція)",
  "Business center (concept, 2015)": "Бізнес-центр (концепція, 2015)",
  "Minimarket": "Мінімаркет",
  "Business center (reconstruction)": "Бізнес-центр (реконструкція)",
  "Residential apartment building. Kamianets-Podilskyi, Ua": "Багатоквартирний житловий будинок, Кам’янець-Подільський, Україна"
};

export function projectDetails(project) {
  return {
    ...project,
    title: translatedTitles[project.title] ?? project.title,
    slug: project.slug || 'project-' + project.id,
    description: project.description || '',
  };
}

export const projectPath = project => '/projects/' + projectDetails(project).slug + '/';
