const fs = require('fs');
const path = require('path');

function localStore() {
  const dir = path.join(__dirname, 'data'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'db.json');
  const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) :
    { users: [], rooms: [], members: [], messages: [], subs: [] };
  // Prevent interrupted writes from leaving an incomplete JSON file.
  const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, file); };
  const imgs = path.join(dir, 'images'); fs.mkdirSync(imgs, { recursive: true });
  return {
    isLocal: true,
    async createUser(o) { db.users.push(o); save(); return o; },
    async userByHash(h) { return db.users.find(x => x.token_hash === h) || null; },
    async createRoom(r, userId) { db.rooms.push(r); db.members.push({ room_id:r.id,user_id:userId,joined_at:new Date().toISOString(),last_read_at:new Date().toISOString() }); save(); return r; },
    async roomByCode(code) { return db.rooms.find(r => r.code === code) || null; },
    async roomById(id) { return db.rooms.find(r => r.id === id) || null; },
    async isMember(roomId,userId) { return db.members.some(m => m.room_id === roomId && m.user_id === userId); },
    async joinRoom(roomId,userId) { if (!db.members.some(m => m.room_id === roomId && m.user_id === userId)) { db.members.push({room_id:roomId,user_id:userId,joined_at:new Date().toISOString(),last_read_at:new Date().toISOString()}); save(); } },
    async roomsForUser(userId) { return db.members.filter(m => m.user_id === userId).map(m => { const r = db.rooms.find(x => x.id === m.room_id); if (!r) return null; const last = db.messages.filter(x => x.room_id === r.id).at(-1); return {...r, member_count:db.members.filter(x => x.room_id === r.id).length, last_message:last ? { body:last.deleted_at ? 'Message deleted' : (last.body || '📷 Image'), author_name:last.author_name, created_at:last.created_at } : null, unread: db.messages.filter(x=>x.room_id===r.id && x.user_id!==userId && x.created_at>(m.last_read_at||m.joined_at)).length}; }).filter(Boolean).sort((a,b) => (b.last_message?.created_at || b.created_at).localeCompare(a.last_message?.created_at || a.created_at)); },
    async roomMembers(roomId) { return db.members.filter(m=>m.room_id===roomId).map(m=>m.user_id); },
    async listMessages(roomId, before) { return db.messages.filter(m=>m.room_id===roomId && (!before || m.created_at < before)).slice(-60); },
    async messageById(id) { return db.messages.find(m=>m.id===id) || null; },
    async createMessage(m) { db.messages.push(m); save(); return m; },
    async updateMessage(id, change) { let m = db.messages.find(x=>x.id===id); if(!m)return null; Object.assign(m,change);save();return {...m}; },
    async markRead(roomId,userId) { const m=db.members.find(x=>x.room_id===roomId && x.user_id===userId);if(m){m.last_read_at=new Date().toISOString();save();} },
    async saveSub(userId,sub) { db.subs=db.subs.filter(x=>x.endpoint!==sub.endpoint);db.subs.push({endpoint:sub.endpoint,user_id:userId,subscription:sub});save(); },
    async subsForUsers(ids) { return db.subs.filter(x=>ids.includes(x.user_id)); },
    async removeSub(endpoint) {db.subs=db.subs.filter(x=>x.endpoint!==endpoint);save();},
    async saveImage(key, bytes) {const file=path.join(imgs,path.basename(key));fs.writeFileSync(file,bytes);},
    async loadImage(key) {return fs.readFileSync(path.join(imgs,path.basename(key)));}
  };
}

function remoteStore(url, key) {
  const { createClient } = require('@supabase/supabase-js');
  const supa = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  async function run(query) { const {data,error} = await query; if(error)throw error;return data; }
  const first = async query => (await run(query.maybeSingle())) || null;
  return {
    isLocal:false,
    async createUser(o) {return run(supa.from('relay_users').insert(o).select().single());},
    async userByHash(h) {return first(supa.from('relay_users').select('*').eq('token_hash',h));},
    async createRoom(r,userId) {let room=await run(supa.from('relay_rooms').insert(r).select().single());await run(supa.from('relay_members').insert({room_id:r.id,user_id:userId,last_read_at:new Date().toISOString()}));return room;},
    async roomByCode(code) {return first(supa.from('relay_rooms').select('*').eq('code',code));},
    async roomById(id) {return first(supa.from('relay_rooms').select('*').eq('id',id));},
    async isMember(roomId,userId) {return !!await first(supa.from('relay_members').select('room_id').eq('room_id',roomId).eq('user_id',userId));},
    async joinRoom(roomId,userId) {await run(supa.from('relay_members').upsert({room_id:roomId,user_id:userId,joined_at:new Date().toISOString(),last_read_at:new Date().toISOString()},{onConflict:'room_id,user_id',ignoreDuplicates:true}));},
    async roomsForUser(userId) {
      let memberships=await run(supa.from('relay_members').select('*').eq('user_id',userId));
      if(!memberships.length)return [];
      let rooms=await run(supa.from('relay_rooms').select('*').in('id',memberships.map(m=>m.room_id)));
      return Promise.all(rooms.map(async r=>{
        let [last, members] = await Promise.all([
          run(supa.from('relay_messages').select('body,author_name,created_at,deleted_at').eq('room_id',r.id).order('created_at',{ascending:false}).limit(1)),
          run(supa.from('relay_members').select('user_id').eq('room_id',r.id))
        ]);
        // head:true returns null data; use count in separate request below instead.
        let countQuery=await supa.from('relay_messages').select('id',{count:'exact',head:true}).eq('room_id',r.id).neq('user_id',userId).gt('created_at',(memberships.find(m=>m.room_id===r.id).last_read_at||memberships.find(m=>m.room_id===r.id).joined_at));
        if(countQuery.error)throw countQuery.error;
        const lm=last[0];
        return {...r,member_count:members.length,unread:countQuery.count||0,last_message:lm ? {...lm,body:lm.deleted_at ? 'Message deleted' : lm.body || '📷 Image'}:null};
      })).then(rs=>rs.sort((a,b)=>(b.last_message?.created_at||b.created_at).localeCompare(a.last_message?.created_at||a.created_at)));
    },
    async roomMembers(roomId) {return (await run(supa.from('relay_members').select('user_id').eq('room_id',roomId))).map(x=>x.user_id);},
    async listMessages(roomId,before) {let q=supa.from('relay_messages').select('*').eq('room_id',roomId).order('created_at',{ascending:false}).limit(60);if(before)q=q.lt('created_at',before);return (await run(q)).reverse();},
    async messageById(id) {return first(supa.from('relay_messages').select('*').eq('id',id));},
    async createMessage(m) {return run(supa.from('relay_messages').insert(m).select().single());},
    async updateMessage(id,change) {return run(supa.from('relay_messages').update(change).eq('id',id).select().single());},
    async markRead(roomId,userId) {await run(supa.from('relay_members').update({last_read_at:new Date().toISOString()}).eq('room_id',roomId).eq('user_id',userId));},
    async saveSub(userId,sub) {await run(supa.from('relay_push_subscriptions').upsert({endpoint:sub.endpoint,user_id:userId,subscription:sub},{onConflict:'endpoint'}));},
    async subsForUsers(ids) {if(!ids.length)return [];return run(supa.from('relay_push_subscriptions').select('*').in('user_id',ids));},
    async removeSub(endpoint) {await run(supa.from('relay_push_subscriptions').delete().eq('endpoint',endpoint));},
    async saveImage(key,bytes) {const {error}=await supa.storage.from('relay-images').upload(key,bytes,{contentType:'image/webp',upsert:false});if(error)throw error;},
    async loadImage(key) {let {data,error}=await supa.storage.from('relay-images').download(key);if(error)throw error;return Buffer.from(await data.arrayBuffer());}
  };
}
function makeStore() {
  const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY} = process.env;
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return remoteStore(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY);
  if (process.env.NODE_ENV === 'production') throw Error('Persistent production chat requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. See README.');
  return localStore();
}
module.exports={makeStore};
