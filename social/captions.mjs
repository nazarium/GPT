const limits={instagram:2196,facebook:5000,tiktok:4000};
export function validateCaptions(input) {
 if(input===undefined)return undefined;
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Некоректні підписи соцмереж');
 const result={};
 for(const [platform,text] of Object.entries(input)) {
  if(!Object.hasOwn(limits,platform)||typeof text!=='string')throw new Error('Некоректний підпис платформи');
  const length=text.length+(platform==='instagram'?(text.match(/\n/g)?.length||0):0);
  if(length>limits[platform])throw new Error('Підпис '+platform+' перевищує ліміт '+limits[platform]+' символів');
  result[platform]=text;
 }
 return result;
}
