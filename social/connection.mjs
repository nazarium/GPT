export function describeConnection(channel,rows,error='') {
 if(error)return {state:'error',account:'Перевірка не вдалася',status:'Стан з’єднання невідомий',detail:error};
 if(rows===null)return {state:'unchecked',account:'Натисніть «Перевірити з’єднання»',status:'Стан ще не перевірений'};
 const actual=rows.find(row=>row.id===channel.id);
 if(!actual)return {state:'error',account:'Канал не знайдено',status:'Канал відсутній у відповіді Buffer',detail:'Перевірте підключення акаунта й налаштування каналу в Buffer.'};
 if(actual.service!==channel.platform)return {state:'error',account:actual.name||'Канал Buffer',status:'Платформа каналу не збігається',detail:'Потрібно перевірити відповідність каналу в налаштуваннях інтеграції.'};
 const result={state:'ok',account:actual.name||'Назву акаунта не надано',status:'З’єднання активне',queue:actual.isQueuePaused?'Чергу Buffer призупинено':'Черга Buffer не призупинена'};
 if(actual.isDisconnected){result.state='error';result.status='Потрібне перепідключення в Buffer';}
 else if(actual.isLocked){result.state='error';result.status='Канал заблокований у Buffer';}
 else if(channel.platform==='facebook'&&actual.type!=='page'){result.state='error';result.status='Для Facebook потрібна сторінка (Page)';}
 else if(actual.isQueuePaused){result.state='warning';}
 if(channel.mode==='notification')result.mobile=actual.hasActiveMemberDevice?'Мобільні сповіщення підключені':'Увійдіть у мобільний Buffer і дозвольте сповіщення.';
 return result;
}
