import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
const out = fileURLToPath(new URL('../outputs/stage-1/', import.meta.url));
await fs.mkdir(out, {recursive:true});
const wb = Workbook.create();
const specs = [
 ['Постачальники',['supplier_id','telegram_user_id','telegram_chat_id','telegram_username','company_name','contact','categories','brands','regions','terms','drive_folder_id','status','created_at','updated_at','confirmed_at']],
 ['Пропозиції',['offer_id','supplier_id','text','status','created_at','updated_at']],
 ['Матеріали',['material_id','offer_id','kind','original_name','drive_file_id','source_url','mime_type','size_bytes','status','created_at','updated_at']],
 ['Довідники',['dictionary','value','active']],
 ['Інструкція',['section','field','description']],
];
const descriptions = {
 supplier_id:'Сталий внутрішній ID постачальника; не залежить від назви компанії.',
 telegram_user_id:'ID Telegram-користувача, текст. Сервер перевіряє право редагування.',
 telegram_chat_id:'ID приватного чату з ботом, текст.',
 telegram_username:'Необов’язковий username; не використовувати як ключ доступу.',
 company_name:'Обов’язкова назва компанії.',contact:'Обов’язковий спосіб зв’язку: телефон, email або інший контакт.',
 categories:'Необов’язкові категорії продукції.',brands:'Необов’язкові бренди.',regions:'Необов’язкові регіони роботи.',terms:'Необов’язкові умови співпраці.',
 drive_folder_id:'ID приватної папки постачальника.',status:'Статус запису; значення наведено в Довідниках.',
 created_at:'Дата створення в ISO 8601 із часовим поясом.',updated_at:'Дата останнього оновлення в ISO 8601 із часовим поясом.',confirmed_at:'Щорічне підтвердження, черга 2; поки порожнє.',
 offer_id:'Сталий ID пропозиції; зв’язок із матеріалами.',text:'Текст пропозиції. Потрібен текст АБО хоча б один файл чи посилання.',
 material_id:'Сталий ID матеріалу.',kind:'file для файлу або link для зовнішнього посилання.',original_name:'Оригінальна назва файлу.',
 drive_file_id:'ID приватного файлу Drive, якщо kind=file.',source_url:'Зовнішнє посилання, якщо kind=link.',mime_type:'MIME-тип файлу.',size_bytes:'Розмір файлу в байтах, число.'
};
const dict = [
 ['supplier_status','active',true],['supplier_status','inactive',true],
 ['offer_status','active',true],['offer_status','archived',true],
 ['material_status','active',true],['material_status','archived',true],
 ['material_kind','file',true],['material_kind','link',true],
];
const instructions = [
 ['Правила','Обов’язкові дані','Назва компанії, контакт і текст пропозиції АБО файл АБО посилання.'],
 ['Правила','Необов’язкові дані','Категорії, бренди, регіони та умови можна пропустити.'],
 ['Правила','Доступ','Лише власник та авторизована інтеграція; постачальники працюють через бота.'],
 ['Правила','Сповіщення','Власнику не надсилати сповіщення про подання чи оновлення.'],
 ['Правила','Секрети','Паролі, токен бота та коди 2FA не зберігати в реєстрі.'],
 ['Правила','Зобов’язання','Реєстрація не гарантує замовлень чи особистої зустрічі.'],
 ...specs.slice(0,3).flatMap(([name,fields])=>fields.map(field=>[name,field,descriptions[field]]))
];
for (const [name,fields] of specs) {
 const s=wb.worksheets.add(name);
 s.showGridLines=true;
 const rows=name==='Довідники'?dict:name==='Інструкція'?instructions:[];
 const end=String.fromCharCode(64+fields.length);
 s.getRange(`A1:${end}${Math.max(2,rows.length+1)}`).format.font={name:'Arial',size:10,color:'#202124'};
 s.getRange(`A1:${end}1`).values=[fields];
 s.getRange(`A1:${end}1`).format={fill:'#F1F3F4',font:{name:'Arial',size:10,bold:true,color:'#202124'},rowHeight:30};
 s.getRange(`A1:${end}2`).format.columnWidth=25;
 s.getRange(`A1:${end}1`).format.horizontalAlignment='center';
 s.freezePanes.freezeRows(1);
 if(rows.length) s.getRange(`A2:${end}${rows.length+1}`).values=rows;
 if(name==='Інструкція'){
  s.getRange(`C1:C${rows.length+1}`).format.columnWidth=95;
  s.getRange(`C2:C${rows.length+1}`).format.wrapText=true;
  s.getRange(`A2:C${rows.length+1}`).format.rowHeight=30;
 }
 if(name==='Постачальники') s.getRange('A2:F1000').setNumberFormat('@');
 if(name==='Матеріали') s.getRange('H2:H1000').setNumberFormat('0');
}
wb.recalculate();
console.log((await wb.inspect({kind:'sheet',include:'id,name',maxChars:2000})).ndjson);
for (let i=0;i<specs.length;i++) {
 const [name,fields]=specs[i];
 const end=String.fromCharCode(64+fields.length);
 const last=name==='Інструкція'?Math.min(12,instructions.length+1):name==='Довідники'?9:3;
 const blob=await wb.render({sheetName:name,range:`A1:${end}${last}`,scale:1,format:'png'});
 await fs.writeFile(`${out}/preview-${i}.png`,new Uint8Array(await blob.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(`${out}/partners-register.xlsx`);
console.log('Saved '+out+'/partners-register.xlsx');
