export const defaultContacts = { address: 'Львів, Україна', phone: '+380 98 437 41 97', telegram: 'nazarium', email: 'nazarium@gmail.com' };

export const phoneHref = phone => 'tel:' + phone.replace(/[^+\d]/g, '');
export const telegramHref = username => 'https://t.me/' + username;
export const emailHref = email => 'mailto:' + encodeURIComponent(email).replace('%40', '@');
