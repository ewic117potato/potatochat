const test=require('node:test');const assert=require('node:assert/strict');
process.env.NODE_ENV='test';delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const {sanitizeName,code}=require('../utils');
test('names are cleaned and truncated',()=>{assert.equal(sanitizeName('  Eric    Gao  '),'Eric Gao');assert.equal(sanitizeName(22),'');assert.equal(sanitizeName('a'.repeat(50)).length,25)});
test('room codes short, readable, varied',()=>{let seen=new Set();for(let i=0;i<100;i++){let v=code();assert.match(v,/^[A-HJ-NP-Z2-9]{5}$/);seen.add(v)}assert.ok(seen.size>98)});
