// Installed into generated source by storage_enable; no platform credentials.
export const STORAGE_CLIENT_PATH = 'src/pixloom-storage.js'
export const storageClientSource = String.raw`// Pixloom local persistence: browser-local, not Cloud or cross-device sync.
const nonce=new URL(location.href).searchParams.get('__pixloom_storage');
const failure=()=>new Error('本地保存失败，请保留输入并重试；请检查浏览器是否允许网站存储');
function validate(key){if(typeof key!=='string'||!key.length||key.length>200)throw new Error('存储键必须为 1–200 个字符')}
function request(action,key,value){
 validate(key);
 if(window.parent!==window){
  if(!nonce)return Promise.reject(new Error('请从 Pixloom 预览入口打开应用以使用本地存储'));
  return new Promise((resolve,reject)=>{
   const channel=new MessageChannel();
   const timer=setTimeout(()=>{channel.port1.close();reject(new Error('本地存储连接超时，请保留输入并重新打开预览'))},5000);
   channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data?.ok?resolve(event.data.result):reject(new Error(event.data?.message||failure().message))};
   const origin=new URL(import.meta.env.BASE_URL,location.href).origin;
   window.parent.postMessage({type:'pixloom-storage-v1',nonce,action,key,value},origin,[channel.port2]);
  });
 }
 try{
  if(action==='get')return Promise.resolve(localStorage.getItem(key));
  if(action==='set')localStorage.setItem(key,value);
  else if(action==='remove')localStorage.removeItem(key);
  return Promise.resolve(null);
 }catch{ return Promise.reject(failure()) }
}
export const storage={
 async get(key,fallback=null){const raw=await request('get',key);return raw===null?fallback:JSON.parse(raw)},
 async set(key,value){const raw=JSON.stringify(value);if(raw===undefined||raw.length>262144)throw new Error('本地数据必须可序列化且不超过 256 KiB');await request('set',key,raw)},
 async remove(key){await request('remove',key)},
};
`
