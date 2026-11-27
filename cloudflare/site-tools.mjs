import {projectCategories} from '../src/project-categories.mjs';
export const defaultTools=()=>({revision:0,categories:{...projectCategories},analyticsToken:'',monthlyBackup:false});
export function validateTools(input,current){
 if(input.revision!==current.revision)return null;
 const entries=Object.entries(input.categories??{});
 if(entries.length<1||entries.length>30||entries.some(([k,v])=>! /^[a-z][a-z0-9-]{0,39}$/.test(k)||k==='all'||!v?.trim()||v.length>80))throw Error('Перевірте назви й коди категорій.');
 if(Object.keys(current.categories).some(k=>!Object.hasOwn(input.categories,k)))throw Error('Наявні категорії можна перейменовувати, але не видаляти.');
 const analyticsToken=String(input.analyticsToken??'').trim();
 if(analyticsToken&&!/^[a-f0-9]{32}$/i.test(analyticsToken))throw Error('Токен Web Analytics має містити 32 шістнадцяткові символи.');
 return {revision:current.revision+1,categories:Object.fromEntries(entries.map(([k,v])=>[k,v.trim()])),analyticsToken,monthlyBackup:input.monthlyBackup===true};
}
