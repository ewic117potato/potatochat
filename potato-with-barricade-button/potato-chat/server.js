require('dotenv').config();
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const helmet = require('helmet');
const {rateLimit} = require('express-rate-limit');
const {Server} = require('socket.io');
const webpush = require('web-push');
const path = require('path');
const {makeStore} = require('./store');
const {sanitizeName,code} = require('./utils');

const store = makeStore();
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'",'https://fonts.googleapis.com'],fontSrc:["'self'",'https://fonts.gstatic.com'],imgSrc:["'self'","blob:","data:"],connectSrc:["'self'","ws:","wss:"],workerSrc:["'self'"],objectSrc:["'none'"]}}}));
app.use(express.json({limit:'12kb'}));
app.use('/api',rateLimit({windowMs:60_000,limit:200,standardHeaders:'draft-7',legacyHeaders:false}));
app.use(express.static(path.join(__dirname,'public'),{index:'index.html',maxAge:'1h'}));
const server = http.createServer(app);
const io = new Server(server,{maxHttpBufferSize:100_000,cors:{origin:false}});
const sessions=new Map();
const lastSent=new Map();
const pushEnabled=Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
if(pushEnabled) webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const uid=()=>crypto.randomUUID();
async function getUser(token){if(typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token))return null;const h=hash(token);if(sessions.has(h))return sessions.get(h);const user=await store.userByHash(h);if(user)sessions.set(h,user);return user;}
async function auth(req,res,next){try{const t=(req.headers.authorization||'').replace(/^Bearer /i,'');req.user=await getUser(t);if(!req.user)return res.status(401).json({error:'Sign in to continue'});next();}catch(e){next(e)}}
async function member(req,res,next){try{const id=req.params.roomId;if(!/^[0-9a-f-]{36}$/i.test(id)||!await store.isMember(id,req.user.id))return res.status(403).json({error:'Not a member of this room'});next();}catch(e){next(e)}}
function safeUser(u){return {id:u.id,name:u.name}};
function safeMsg(m){return {...m,image_key:undefined,has_image:!!m.image_key && !m.deleted_at};}
function fail(res,status,error){return res.status(status).json({error});}
async function broadcasts(roomId){const [rooms,members]=await Promise.all([store.roomById(roomId),store.roomMembers(roomId)]);for(const id of members)io.to('user:'+id).emit('rooms:refresh');return rooms;}
async function sendPush(memberIds,authorId,title,body,roomId){if(!pushEnabled)return;try{const subscribers=await store.subsForUsers(memberIds.filter(id=>id!==authorId));await Promise.allSettled(subscribers.map(async sub=>{try{await webpush.sendNotification(sub.subscription,JSON.stringify({title,body,roomId,url:'/?room='+encodeURIComponent(roomId)}),{TTL:3600});}catch(e){if(e.statusCode===404||e.statusCode===410)await store.removeSub(sub.endpoint);}}));}catch(e){console.error('Push delivery error:',e.message)}}

app.get('/api/config',(req,res)=>res.json({pushEnabled,vapidPublicKey:pushEnabled?process.env.VAPID_PUBLIC_KEY:null,localMode:store.isLocal,gameUrl:process.env.GAME_URL||null}));
app.post('/api/register',rateLimit({windowMs:3600_000,limit:15,standardHeaders:'draft-7',legacyHeaders:false}),async(req,res,next)=>{try{const name=sanitizeName(req.body?.name);if(name.length<2)return fail(res,400,'Nickname must have at least two characters');const token=crypto.randomBytes(32).toString('hex');const user=await store.createUser({id:uid(),name,token_hash:hash(token),created_at:new Date().toISOString()});res.status(201).json({token,user:safeUser(user)});}catch(e){next(e)}});
app.get('/api/me',auth,(req,res)=>res.json({user:safeUser(req.user)}));
app.get('/api/rooms',auth,async(req,res,next)=>{try{res.json({rooms:await store.roomsForUser(req.user.id)})}catch(e){next(e)}});
app.post('/api/rooms',auth,async(req,res,next)=>{try{const name=typeof req.body.name==='string'?req.body.name.trim().slice(0,45):'';if(name.length<2)return fail(res,400,'Choose a room name of at least two characters');let room;for(let i=0;i<8;i++){const newCode=code();if(await store.roomByCode(newCode))continue;try{room=await store.createRoom({id:uid(),name,code:newCode,owner_id:req.user.id,created_at:new Date().toISOString()},req.user.id);break;}catch(e){if(e.code!=='23505')throw e}}if(!room)throw Error('Could not generate an invite code');io.to('user:'+req.user.id).emit('rooms:refresh');res.status(201).json({room});}catch(e){next(e)}});
app.post('/api/rooms/join',auth,async(req,res,next)=>{try{const invite=String(req.body.code||'').trim().toUpperCase();if(!/^[A-HJ-NP-Z2-9]{5}$/.test(invite))return fail(res,400,'Enter a five-character code');const room=await store.roomByCode(invite);if(!room)return fail(res,404,'Room not found');await store.joinRoom(room.id,req.user.id);io.to('room:'+room.id).emit('members:update');await broadcasts(room.id);res.json({room});}catch(e){next(e)}});
app.get('/api/rooms/:roomId/messages',auth,member,async(req,res,next)=>{try{const before=req.query.before;if(before && (typeof before!=='string'||!/^\d{4}-\d\d-\d\dT/.test(before)||!Number.isFinite(Date.parse(before))))return fail(res,400,'Invalid date cursor');res.json({messages:(await store.listMessages(req.params.roomId,before)).map(safeMsg)});}catch(e){next(e)}});
app.post('/api/rooms/:roomId/read',auth,member,async(req,res,next)=>{try{await store.markRead(req.params.roomId,req.user.id);res.json({ok:true});}catch(e){next(e)}});
app.get('/api/rooms/:roomId/members',auth,member,async(req,res,next)=>{try{res.json({count:(await store.roomMembers(req.params.roomId)).length});}catch(e){next(e)}});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:7*1024*1024,files:1,fields:4},fileFilter:(req,file,cb)=>{if(!/^image\/(jpeg|png|webp|gif|avif)$/i.test(file.mimetype))return cb(Error('Only JPG, PNG, WEBP, GIF and AVIF images are supported'));cb(null,true)}});
app.post('/api/rooms/:roomId/messages',auth,member,upload.single('image'),async(req,res,next)=>{try{
  const body=typeof req.body.body==='string'?req.body.body.trim():'';
  if(body.length>2000)return fail(res,400,'Message exceeds 2,000 characters');
  if(!body && !req.file)return fail(res,400,'Type a message or choose an image');
  const stamp=Date.now();const rate=lastSent.get(req.user.id)||0;if(stamp-rate<450)return fail(res,429,'Wait a moment before sending another message');lastSent.set(req.user.id,stamp);
  let imageKey=null;
  if(req.file){let bytes;try{bytes=await sharp(req.file.buffer,{limitInputPixels:24e6,animated:false}).rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:82,effort:3}).toBuffer();}catch(e){return fail(res,400,'Could not read this image. Try a different file.')}imageKey=req.params.roomId+'/'+uid()+'.webp';await store.saveImage(imageKey,bytes);}
  const m=await store.createMessage({id:uid(),room_id:req.params.roomId,user_id:req.user.id,author_name:req.user.name,body,image_key:imageKey,created_at:new Date().toISOString(),edited_at:null,deleted_at:null,reactions:{}});
  const safe=safeMsg(m);io.to('room:'+req.params.roomId).emit('message:new',safe);await broadcasts(req.params.roomId);res.status(201).json({message:safe});
  // Push asynchronously after response to keep sending fast.
  store.roomMembers(req.params.roomId).then(ids=>sendPush(ids,req.user.id,req.user.name,body||'📷 Sent an image',req.params.roomId)).catch(e=>console.error('Push:',e.message));
}catch(e){next(e)}});
app.get('/api/messages/:messageId/image',auth,async(req,res,next)=>{try{const m=await store.messageById(req.params.messageId);if(!m||!m.image_key||m.deleted_at)return fail(res,404,'Image unavailable');if(!await store.isMember(m.room_id,req.user.id))return fail(res,403,'Not a member');let data=await store.loadImage(m.image_key);res.setHeader('Content-Type','image/webp');res.setHeader('Cache-Control','private, max-age=1200');res.send(data);}catch(e){next(e)}});
app.patch('/api/messages/:messageId',auth,async(req,res,next)=>{try{const m=await store.messageById(req.params.messageId);if(!m||m.deleted_at)return fail(res,404,'Message not found');if(m.user_id!==req.user.id)return fail(res,403,'You can only edit your own messages');const body=typeof req.body.body==='string'?req.body.body.trim():'';if(!body||body.length>2000)return fail(res,400,'Message must be 1–2,000 characters');const updated=await store.updateMessage(m.id,{body,edited_at:new Date().toISOString()});io.to('room:'+m.room_id).emit('message:update',safeMsg(updated));res.json({message:safeMsg(updated)});}catch(e){next(e)}});
app.delete('/api/messages/:messageId',auth,async(req,res,next)=>{try{const m=await store.messageById(req.params.messageId);if(!m||m.deleted_at)return fail(res,404,'Message not found');if(m.user_id!==req.user.id)return fail(res,403,'You can only delete your own messages');const updated=await store.updateMessage(m.id,{body:'',deleted_at:new Date().toISOString(),reactions:{}});io.to('room:'+m.room_id).emit('message:update',safeMsg(updated));res.json({ok:true});}catch(e){next(e)}});
const EMOJIS=['❤️','😂','🔥','👍','💀','🎮','✨'];
app.post('/api/messages/:messageId/react',auth,async(req,res,next)=>{try{const m=await store.messageById(req.params.messageId);if(!m||m.deleted_at)return fail(res,404,'Message not found');if(!await store.isMember(m.room_id,req.user.id))return fail(res,403,'Not a member');const emoji=req.body.emoji;if(!EMOJIS.includes(emoji))return fail(res,400,'Unsupported reaction');const reactions={...m.reactions};const users=Array.isArray(reactions[emoji])?reactions[emoji].filter(x=>typeof x==='string'):[];reactions[emoji]=users.includes(req.user.id)?users.filter(x=>x!==req.user.id):users.concat(req.user.id);if(!reactions[emoji].length)delete reactions[emoji];const updated=await store.updateMessage(m.id,{reactions});io.to('room:'+m.room_id).emit('message:update',safeMsg(updated));res.json({message:safeMsg(updated)});}catch(e){next(e)}});
app.post('/api/push/subscribe',auth,async(req,res,next)=>{try{if(!pushEnabled)return fail(res,503,'Push server is not configured');const sub=req.body?.subscription;if(typeof sub?.endpoint!=='string'||!sub.endpoint.startsWith('https://')||sub.endpoint.length>2000||!sub.keys?.p256dh||!sub.keys?.auth)return fail(res,400,'Invalid push subscription');await store.saveSub(req.user.id,sub);res.json({ok:true});}catch(e){next(e)}});
app.get('/health',(req,res)=>res.json({status:'ok',persistent:!store.isLocal,push:pushEnabled}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err,req,res,next)=>{console.error(err);if(err.code==='LIMIT_FILE_SIZE')return fail(res,413,'Image must be under 7 MB');if(/Only JPG/.test(err.message))return fail(res,400,err.message);if(err instanceof multer.MulterError)return fail(res,400,err.message);return fail(res,500,'Something went wrong. Check the server logs.');});
io.use(async(socket,next)=>{try{const user=await getUser(socket.handshake.auth?.token);if(!user)return next(Error('Unauthorized'));socket.user=user;next();}catch(e){next(e)}});
io.on('connection',async socket=>{
  socket.join('user:'+socket.user.id);
  // Join only rooms the server confirms this account belongs to.
  try{const rooms=await store.roomsForUser(socket.user.id);rooms.forEach(r=>socket.join('room:'+r.id));}catch(e){console.error('Socket room join:',e.message)}
  socket.on('room:join',async id=>{if(typeof id!=='string')return;try{if(await store.isMember(id,socket.user.id))socket.join('room:'+id);}catch(e){}});
  socket.on('typing',async d=>{if(!d||typeof d.roomId!=='string')return;try{if(await store.isMember(d.roomId,socket.user.id)){socket.to('room:'+d.roomId).emit('typing',{roomId:d.roomId,user:safeUser(socket.user),typing:!!d.typing});}}catch(e){}});
});
const port=Number(process.env.PORT)||3000;
if(require.main===module)server.listen(port,'0.0.0.0',()=>console.log('POTATO chat at http://localhost:'+port+(store.isLocal?' [LOCAL DATA ONLY]':' [Supabase]')+(pushEnabled?' [PUSH ENABLED]':' [NO PUSH KEYS]')));
module.exports={app,server,store,code,sanitizeName};
