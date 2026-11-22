/* Pure dialogue: no Google services, network calls or secrets. */
var ACP_GREETING = "Вітаємо в партнерській системі Archi-Create!\n\nМи приймаємо пропозиції від виробників, дистриб'юторів, постачальників будівельних матеріалів та послуг.\n\nВи можете надіслати інформацію про послуги, продукцію, каталоги, прайс-листи та умови співпраці.\n\nВаші матеріали будуть збережені в нашій базі. У разі виникнення потреби ми самостійно зв'яжемося з вами.\n\nРеєстрація не гарантує замовлень чи особистої зустрічі.";
var ACP_FIELDS = {company_name:'Назва компанії',contact:'Контакт',categories:'Категорії',brands:'Бренди',regions:'Регіони',terms:'Умови'};
var ACP_MAIN = ['Подати пропозицію','Оновити матеріали'];
function acpClone_(x) { return JSON.parse(JSON.stringify(x)); }
function acpEmpty_() { return {step:'home',buttons:[],version:'0',draft:null}; }
function acpNonempty_(x) { return typeof x === 'string' && !!x.trim(); }
function acpHasContent_(d) { return acpNonempty_(d.text) || d.materials.length > 0; }
function acpSingleCompany_(ctx) {
  var own=ctx.suppliers.filter(function(p){return String(p.telegram_user_id)===ctx.actor;});
  if(own.length>1)throw new Error('MULTIPLE_COMPANIES_REQUIRE_REVIEW');
  return own.length?acpClone_(own[0]):null;
}
function acpDraft_(ctx,event,company) {
  var bound=acpSingleCompany_(ctx);
  if(bound&&(!company||bound.supplier_id!==company.supplier_id))throw new Error('ACCOUNT_ALREADY_BOUND');
  var p=company?acpClone_(company):{};
  if(!company) {
    ['company_name','contact','categories','brands','regions','terms','drive_folder_id','confirmed_at'].forEach(function(k){p[k]='';});
    p.supplier_id='s'+event.id;p.telegram_user_id=ctx.actor;p.telegram_chat_id=ctx.chat;
    p.telegram_username=ctx.username||'';p.status='active';p.created_at=ctx.now;p.updated_at=ctx.now;
  }
  return {supplier:p,newCompany:!company,offer_id:'o'+event.id,mode:'new',text:'',materials:[],failed:[],base_updated_at:company?company.updated_at:''};
}
function acpOwn_(ctx, id) {
  acpSingleCompany_(ctx);
  var all=ctx.suppliers.filter(function(s){return s.supplier_id===id && String(s.telegram_user_id)===ctx.actor;});
  if(all.length!==1) throw new Error('SUPPLIER_NOT_ACCESSIBLE');
  return acpClone_(all[0]);
}
function acpOffer_(ctx,id,supplier) {
  var all=ctx.offers.filter(function(o){return o.offer_id===id && o.supplier_id===supplier && o.status==='active';});
  if(all.length!==1) throw new Error('OFFER_NOT_ACCESSIBLE');
  return acpClone_(all[0]);
}
function acpView_(s, event, text, buttons, home) {
  s.version=String(event.id); s.buttons=buttons||[];
  var markup=home?{keyboard:ACP_MAIN.map(function(t){return [{text:t}];}),resize_keyboard:true}:{};
  if(!home && s.buttons.length) markup.inline_keyboard=s.buttons.map(function(b,i){return [{text:b[0],callback_data:'b:'+s.version+':'+i}];});
  return {state:s,reply:{text:text,markup:markup},effect:null};
}
function acpHome_(s,e,text) { s.step='home';s.draft=null;return acpView_(s,e,text||ACP_GREETING,[],true); }
function acpReview_(s,e,note) {
  s.step='review';var d=s.draft, p=d.supplier;
  var text=(note?note+'\n\n':'')+'Перевірте пропозицію:\nКомпанія: '+p.company_name+'\nКонтакт: '+p.contact+'\nПропозиція: '+(d.text?d.text.slice(0,1000):'Матеріали без текстового опису')+'\nФайлів: '+d.materials.filter(function(m){return m.kind==='file';}).length+'\nПосилань: '+d.materials.filter(function(m){return m.kind==='link';}).length;
  ['categories','brands','regions','terms'].forEach(function(f){if(p[f])text+='\n'+ACP_FIELDS[f]+': '+p[f].slice(0,150);});
  var buttons=[['Зберегти','save'],['Додати відомості','extras'],['Виправити','fix'],['Скасувати','cancel']];
  if(d.failed && d.failed.length)buttons.splice(1,0,['Продовжити без невдалих файлів','omitFailed']);
  return acpView_(s,e,text,buttons);
}
function acpCompanyMenu_(s,e) {
  s.step='companyMenu';
  return acpView_(s,e,'Що бажаєте оновити для «'+s.selected.company_name+'»?',[['Контакти й назва','profile'],['Пропозиції та файли','offers'],['Додаткові відомості','profileExtras'],['Назад','home']]);
}
function acpPickCompanies_(s,e,ctx,mode) {
  var company=acpSingleCompany_(ctx);
  s.intent=mode;
  if(!company) {
    if(mode==='update')return acpHome_(s,e,'Для вашого Telegram-акаунта поки немає збережених пропозицій. Натисніть «Подати пропозицію», щоб додати першу.');
    s.draft=acpDraft_(ctx,e);s.step='name';return acpView_(s,e,'Як називається ваша компанія або бренд, який ви представляєте?',[['Скасувати','cancel']]);
  }
  s.selected=company;
  if(mode==='update')return acpCompanyMenu_(s,e);
  s.draft=acpDraft_(ctx,e,company);s.step='materials';
  return acpView_(s,e,'Надішліть пропозицію для «'+company.company_name+'» текстом, файлом або посиланням. Коли завершите, натисніть «Готово».',[['Готово','done'],['Скасувати','cancel']]);
}
function acpFieldMenu_(s,e,profile,extras) {
  s.step='fields';s.fieldProfile=profile;s.fieldExtras=extras;
  var fields=extras?['categories','brands','regions','terms']:['company_name','contact'];
  var buttons=fields.map(function(f){return [ACP_FIELDS[f],'field',f];});
  buttons.push(['Готово','fieldsDone']); buttons.push(['Скасувати','cancel']);
  return acpView_(s,e,extras?'Додаткові відомості — за бажанням:':'Оберіть поле для зміни:',buttons);
}
function acpReducer_(previous,event,ctx) {
  var s=acpClone_(previous||acpEmpty_()), action=null, arg=null;
  var text=typeof event.text==='string'?event.text.trim():'';
  if(event.callback) {
    var parts=event.callback.split(':');var i=Number(parts[2]);
    if(parts.length!==3 || parts[0]!=='b' || parts[1]!==s.version || !Number.isInteger(i) || i<0 || !s.buttons[i]) {
      return acpView_(s,{id:s.version},'Ця дія вже неактуальна. Скористайтеся кнопками нижче для поточного кроку.',s.buttons,s.step==='home');
    }
    action=s.buttons[i][1];arg=s.buttons[i][2];
  }
  if(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s.*)?$/.test(text)||ACP_MAIN.indexOf(text)>=0) {
    var intent=text===ACP_MAIN[0]?'new':text===ACP_MAIN[1]?'update':'home';
    if(s.draft||s.profile||s.step==='interrupt') {
      s={resume:acpClone_(s.step==='interrupt'?s.resume:s),pendingIntent:intent,step:'interrupt'};
      return acpView_(s,event,'У вас є незбережені зміни. Продовжити чи скасувати?',[['Продовжити','resume'],['Скасувати зміни','discard']]);
    }
    return intent==='home'?acpHome_(s,event):acpPickCompanies_(s,event,ctx,intent);
  }
  if(!action&&s.step==='interrupt') {
    if(text==='Продовжити')action='resume';
    else if(text==='Скасувати зміни')action='discard';
  }
  if(action==='resume' && s.resume) {var old=s.resume;return acpView_(old,event,old.step==='name'?'Як називається ваша компанія або бренд, який ви представляєте?':'Продовжуємо з поточного кроку.',old.buttons);}
  if(action==='discard') {var next=s.pendingIntent||'home';s=acpEmpty_();return next==='home'?acpHome_(s,event,'Зміни скасовано.'):acpPickCompanies_(s,event,ctx,next);}
  if(action==='home') {s=acpEmpty_();return acpHome_(s,event);}
  if(action==='cancel') {
    s={resume:acpClone_(s),pendingIntent:'home',step:'interrupt'};
    return acpView_(s,event,'Скасувати незбережені зміни?',[['Продовжити','resume'],['Скасувати зміни','discard']]);
  }
  if(action==='otherCompany')return acpPickCompanies_(acpEmpty_(),event,ctx,'new');
  if(action==='company') {
    s.selected=acpOwn_(ctx,arg);
    if(s.intent==='update')return acpCompanyMenu_(s,event);
    return acpPickCompanies_(acpEmpty_(),event,ctx,'new');
  }
  if(action==='updateCompany')return acpCompanyMenu_(s,event);
  if(action==='newOffer') {s.draft=acpDraft_(ctx,event,acpOwn_(ctx,s.selected.supplier_id));s.step='materials';return acpView_(s,event,'Надішліть пропозицію текстом, файлом або посиланням. Коли завершите, натисніть «Готово».',[['Готово','done'],['Скасувати','cancel']]);}
  if(s.step==='name') {
    if(!text || text.length>200)return acpView_(s,event,'Напишіть назву компанії текстом, до 200 символів.',[['Скасувати','cancel']]);
    s.draft.supplier.company_name=text;s.step='contact';
    return acpView_(s,event,'Як із вами зв’язатися? Напишіть телефон, email або інший зручний контакт.',[['Назад','backName'],['Скасувати','cancel']]);
  }
  if(action==='backName') {s.step='name';return acpView_(s,event,'Вкажіть назву компанії:',[['Скасувати','cancel']]);}
  if(s.step==='contact') {
    if(event.contact)text=[event.contact.phone_number,event.contact.first_name,event.contact.last_name].filter(Boolean).join(' ');
    if(!text||text.length>500)return acpView_(s,event,'Додайте контакт для зв’язку, до 500 символів — наприклад, телефон або email.',[['Назад','backName'],['Скасувати','cancel']]);
    s.draft.supplier.contact=text;s.step='materials';
    return acpView_(s,event,'Надішліть вашу пропозицію текстом, файлом або посиланням. Можна кілька повідомлень. Коли завершите, натисніть «Готово».',[['Готово','done'],['Назад','backContact'],['Скасувати','cancel']]);
  }
  if(action==='backContact') {s.step='contact';return acpView_(s,event,'Вкажіть контакт для зв’язку:',[['Назад','backName'],['Скасувати','cancel']]);}
  if(action==='done' && s.draft) {
    if(!acpHasContent_(s.draft))return acpView_(s,event,'Спочатку надішліть текст пропозиції, файл або посилання.',[['Готово','done'],['Скасувати','cancel']]);
    return acpReview_(s,event);
  }
  if(action==='extras')return acpFieldMenu_(s,event,false,true);
  if(action==='fix') {s.step='fix';return acpView_(s,event,'Що виправити?',[['Назва компанії','field','company_name'],['Контакт','field','contact'],['Матеріали','draftMaterials'],['Готово','done'],['Скасувати','cancel']]);}
  if(action==='profile'||action==='profileExtras') {
    s.profile=acpOwn_(ctx,s.selected.supplier_id);
    return acpFieldMenu_(s,event,true,action==='profileExtras');
  }
  if(action==='field') {
    if(!ACP_FIELDS[arg])throw new Error('UNKNOWN_FIELD');s.field=arg;s.step='fieldInput';
    return acpView_(s,event,'Вкажіть «'+ACP_FIELDS[arg]+'»'+(['company_name','contact'].indexOf(arg)<0?' — можна пропустити або очистити.':'.'),[['Пропустити','fieldSkip']].concat(['company_name','contact'].indexOf(arg)<0?[['Очистити поле','fieldClear']]:[]).concat([['Скасувати','cancel']]));
  }
  if(s.step==='fieldInput') {
    var target=s.fieldProfile?s.profile:s.draft.supplier;
    if(action!=='fieldSkip') {
      if(action==='fieldClear')text='';
      else if(!text || text.length>(s.field==='company_name'?200:s.field==='contact'?500:1000))return acpView_(s,event,'Вкажіть значення текстом. Для назви — до 200, контакту — до 500, інших полів — до 1000 символів.',s.buttons);
      target[s.field]=text;
    }
    return acpFieldMenu_(s,event,!!s.fieldProfile,!!s.fieldExtras);
  }
  if(action==='fieldsDone') {
    if(s.fieldProfile) {s.step='profileReview';return acpView_(s,event,'Зберегти зміни?\n'+Object.keys(ACP_FIELDS).map(function(f){return ACP_FIELDS[f]+': '+(s.profile[f]||'—');}).join('\n'),[['Зберегти зміни','saveProfile'],['Виправити','profileFields'],['Скасувати','cancel']]);}
    return acpReview_(s,event);
  }
  if(action==='profileFields')return acpFieldMenu_(s,event,true,!!s.fieldExtras);
  if(action==='saveProfile') {
    acpOwn_(ctx,s.profile.supplier_id);var p=acpClone_(s.profile);
    if(!acpNonempty_(p.company_name)||!acpNonempty_(p.contact))throw new Error('REQUIRED_PROFILE_FIELDS');
    var saved=acpHome_(acpEmpty_(),event,'Зміни збережено. Дякуємо, що підтримуєте інформацію актуальною.');
    saved.effect={type:'profile',supplier:p};return saved;
  }
  if(action==='offers') {
    acpOwn_(ctx,s.selected.supplier_id);s.step='offers';
    var offers=ctx.offers.filter(function(o){return o.supplier_id===s.selected.supplier_id&&o.status==='active';});
    return acpView_(s,event,offers.length?'Оберіть пропозицію:':'Збережених пропозицій немає. Можете додати нову.',offers.map(function(o){return [(o.text||'Пропозиція '+o.offer_id).slice(0,40)+' · '+String(o.updated_at).slice(0,10),'offer',o.offer_id];}).concat([['Нова пропозиція','newOffer'],['Назад','updateCompany']]));
  }
  if(action==='offer') {
    var company=acpOwn_(ctx,s.selected.supplier_id),offer=acpOffer_(ctx,arg,company.supplier_id);
    s.draft=acpDraft_(ctx,event,company);s.draft.offer_id=offer.offer_id;s.draft.mode='edit';s.draft.text=offer.text||'';s.draft.created_at=offer.created_at;
    s.draft.materials=ctx.materials.filter(function(m){return m.offer_id===offer.offer_id&&m.status==='active';}).map(acpClone_);
    return acpMaterialMenu_(s,event);
  }
  if(action==='draftMaterials')return acpMaterialMenu_(s,event);
  if(action==='editText') {s.step='editText';return acpView_(s,event,'Надішліть новий текст пропозиції або очистіть його, якщо є файли чи посилання.',[['Очистити текст','clearText'],['Назад','draftMaterials'],['Скасувати','cancel']]);}
  if(s.step==='editText') {
    if(action==='clearText')text='';else if(!text||text.length>6000)return acpView_(s,event,'Вкажіть текст до 6000 символів.',s.buttons);
    if(!text&&!s.draft.materials.length)return acpView_(s,event,'Спочатку додайте файл або посилання, щоб очистити текст.',s.buttons);
    s.draft.text=text;return acpMaterialMenu_(s,event);
  }
  if(action==='add') {s.step='materials';return acpView_(s,event,'Надішліть додаткові матеріали або текст. Старі файли залишаться.',[['Готово','done'],['Скасувати','cancel']]);}
  if(action==='remove'||action==='replace') {
    s.materialAction=action;s.step='pickMaterial';
    return acpView_(s,event,'Оберіть матеріал:',s.draft.materials.map(function(m){return [(m.original_name||m.source_url||'Матеріал').slice(0,60),'material',m.material_id];}).concat([['Назад','draftMaterials']]));
  }
  if(action==='material') {
    var material=s.draft.materials.find(function(m){return m.material_id===arg;});if(!material)throw new Error('MATERIAL_NOT_ACCESSIBLE');
    s.materialId=arg;
    if(s.materialAction==='replace') {s.step='replaceInput';return acpView_(s,event,'Надішліть новий файл або посилання замість «'+(material.original_name||material.source_url).slice(0,150)+'». Старий матеріал залишиться до збереження.',[['Назад','draftMaterials'],['Скасувати','cancel']]);}
    s.step='removeConfirm';return acpView_(s,event,'Прибрати «'+(material.original_name||material.source_url).slice(0,150)+'» з актуальної пропозиції?',[['Так, прибрати','removeYes'],['Назад','draftMaterials']]);
  }
  if(action==='removeYes') {
    if(!s.draft.text&&s.draft.materials.length===1)return acpMaterialMenu_(s,event,'Спочатку додайте інший матеріал або текст.');
    s.draft.materials=s.draft.materials.filter(function(m){return m.material_id!==s.materialId;});return acpMaterialMenu_(s,event);
  }
  if(action==='omitFailed') {
    s.draft.materials=s.draft.materials.filter(function(m){return s.draft.failed.indexOf(m.material_id)<0;});s.draft.failed=[];
    if(!acpHasContent_(s.draft)) {s.step='materials';return acpView_(s,event,'Додайте текст, інший файл або посилання перед збереженням.',[['Готово','done'],['Скасувати','cancel']]);}
    return acpReview_(s,event);
  }
  if(action==='save') {
    var bound=acpSingleCompany_(ctx);
    if(bound&&s.draft&&(s.draft.newCompany||s.draft.supplier.supplier_id!==bound.supplier_id))return acpHome_(acpEmpty_(),event,'Ваш Telegram-акаунт уже прив’язаний до компанії «'+bound.company_name+'». Натисніть «Подати пропозицію», щоб подати матеріали від неї.');
    if(!s.draft || !acpHasContent_(s.draft)||!acpNonempty_(s.draft.supplier.company_name)||!acpNonempty_(s.draft.supplier.contact))throw new Error('INCOMPLETE_PROPOSAL');
    if(!s.draft.newCompany)acpOwn_(ctx,s.draft.supplier.supplier_id);
    var result=acpHome_(acpEmpty_(),event,s.draft.mode==='edit'?'Зміни збережено. Дякуємо, що підтримуєте інформацію актуальною.':'Дякуємо! Вашу пропозицію збережено.\n\nЯкщо виникне потреба, ми самостійно зв’яжемося з вами. Реєстрація не гарантує замовлень чи особистої зустрічі.\n\nЩоб змінити контакти або матеріали, натисніть «Оновити матеріали».');
    result.effect={type:'offer',draft:acpClone_(s.draft)};return result;
  }
  if(s.step==='materials'||s.step==='replaceInput') {
    var accepted=[], note='', max=15;
    if(event.document) {
      var f=event.document;
      if(typeof f.file_size!=='number'||f.file_size<0||f.file_size>20000000)return acpView_(s,event,'Цей файл не вдалося прийняти. Для каталогу понад 20 МБ надішліть посилання.',s.buttons);
      accepted.push({material_id:'m'+event.id,kind:'file',original_name:String(f.file_name||'document').slice(0,150),telegram_file:acpClone_(f),drive_file_id:'',source_url:'',mime_type:f.mime_type||'',size_bytes:f.file_size});
    }
    var urls=(text.match(/https?:\/\/[^\s<>]+/g)||[]).filter(function(u,i,a){return a.indexOf(u)===i;});
    if(urls.length>10)return acpView_(s,event,'Надішліть до 10 посилань одним повідомленням.',s.buttons);
    urls.forEach(function(u,i){if(u.length<=2000)accepted.push({material_id:'m'+event.id+'l'+i,kind:'link',source_url:u,original_name:'',drive_file_id:'',mime_type:'',size_bytes:''});});
    if(s.step==='replaceInput') {
      if(accepted.length!==1)return acpView_(s,event,'Для заміни надішліть один файл або одне посилання.',s.buttons);
      s.draft.materials=s.draft.materials.map(function(m){return m.material_id===s.materialId?accepted[0]:m;});
      return acpReview_(s,event,'Заміна підготовлена. Старий матеріал залишиться актуальним до успішного збереження.');
    }
    if(s.draft.materials.length+accepted.length>max)return acpView_(s,event,'В одній пропозиції можна до 15 матеріалів. Для великих добірок надішліть посилання на каталог.',s.buttons);
    if(text && s.draft.text.length+text.length+1>6000)return acpView_(s,event,'Текст пропозиції — до 6000 символів. Решту можна додати файлом або посиланням.',s.buttons);
    if(!text&&!accepted.length)return acpView_(s,event,'Надішліть пропозицію текстом, документом або посиланням.',s.buttons);
    if(text)s.draft.text+=(s.draft.text?'\n':'')+text;
    s.draft.materials=s.draft.materials.concat(accepted);s.draft.failed=[];
    note=event.document?'Додано до чернетки: '+accepted[0].original_name+'.':'Матеріали додано до чернетки.';
    return acpView_(s,event,note+' Можете надіслати ще або натиснути «Готово».',[['Готово','done'],['Скасувати','cancel']]);
  }
  return acpView_(s,{id:s.version},s.step==='interrupt'?'Спочатку натисніть «Продовжити» нижче. Дані анкети ще не прийнято.':'Скористайтеся кнопками поточного кроку або головним меню.',s.buttons,s.step==='home');
}
function acpMaterialMenu_(s,e,note) {
  s.step='materialMenu';return acpView_(s,e,(note?note+'\n\n':'')+'Що змінити в пропозиції?',[['Змінити текст','editText'],['Додати матеріали','add'],['Замінити матеріал','replace'],['Прибрати матеріал','remove'],['Готово','done'],['Скасувати','cancel']]);
}
