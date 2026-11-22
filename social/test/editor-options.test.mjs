import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEditorOptions,descriptionFromCaption,formatTags,tagsForPlatform} from '../editor-options.mjs';
test('editor options validate title, date and the combined Instagram limit',()=>{
 assert.equal(validateEditorOptions(undefined),undefined);
 assert.throws(()=>validateEditorOptions({title:' '}),/Назва/);
 assert.throws(()=>validateEditorOptions({useCommonCaption:1}),/перемикач/);
 assert.throws(()=>validateEditorOptions({dueAt:'bad'}),/дат/);
 assert.throws(()=>validateEditorOptions({title:'Title',composeTitle:true,useCommonCaption:true,commonCaption:'x'.repeat(2196)}),/Instagram/);
 assert.equal(validateEditorOptions({dueAt:'2026-11-20T10:00:00+02:00'}).dueAt,'2026-11-20T08:00:00.000Z');
});
test('description extraction separates an exact heading and preserves unrelated custom text',()=>{
 const project={title:'Назва',number:'02'};
 assert.equal(descriptionFromCaption('Назва — 02\n\nОпис\nURL',project),'Опис\nURL');
 assert.equal(descriptionFromCaption('Інший текст',project),'Інший текст');
 assert.equal(descriptionFromCaption('Власна назва\n\nОпис',project,'Власна назва'),'Опис');
});

test('tags accept Unicode, normalize separators and hashes, deduplicate and reject invalid input',()=>{
 assert.equal(formatTags('архітектура, #Дизайн; ARCHI_create\n#архітектура'),'#архітектура #Дизайн #ARCHI_create');
 assert.equal(formatTags(''),'');
 assert.throws(()=>formatTags('bad-tag'),/тегах/);
 assert.throws(()=>validateEditorOptions({platformTags:{other:'tag'}}),/платформа/);
 assert.throws(()=>validateEditorOptions({commonTags:42}),/текстом/);
 assert.equal(tagsForPlatform({commonTags:'shared',platformTags:{instagram:'own'}},'instagram'),'#shared');
 assert.equal(tagsForPlatform({useCommonTags:false,commonTags:'shared',platformTags:{instagram:'own'}},'instagram'),'#own');
 assert.throws(()=>validateEditorOptions({composeTitle:true,title:'Title',useCommonCaption:true,commonCaption:'x'.repeat(2180),commonTags:'abcdefghijklmnop'}),/Instagram/);
});
