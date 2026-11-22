export async function submitSelected(ids,rows,submit,onSuccess=()=>{}) {
 const succeeded=[],failed=[];
 for(const id of [...new Set(ids)]) {
  const row=rows.find(row=>row.id===id);
  if(!row?.active){failed.push({id,error:'Проєкт прихований або відсутній'});continue;}
  try {await submit(row);succeeded.push(id);onSuccess(id);}
  catch(error){failed.push({id,error:error.message||'Не вдалося передати проєкт'});}
 }
 return {succeeded,failed};
}
export function deliveryDisabledReason(data,busy,dirty) {
 if(busy)return 'Триває обробка. Зачекайте.';
 if(dirty)return 'Спочатку збережіть або скасуйте зміни налаштувань.';
 if(!data.live&&data.environmentMode!=='live')return 'Тестовий режим: реальну передачу в Buffer вимкнено.';
 if(!data.live&&!data.keyConfigured)return 'Ключ Buffer ще не налаштований у Cloudflare.';
 return '';
}
