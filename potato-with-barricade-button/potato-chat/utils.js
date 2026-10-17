const crypto=require('crypto');
const NAME_MAX=25;
function sanitizeName(input){return typeof input==='string' ? input.trim().replace(/\s+/g,' ').slice(0,NAME_MAX):'';}
function code(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from(crypto.randomBytes(5),b=>chars[b%chars.length]).join('');}
module.exports={sanitizeName,code};
