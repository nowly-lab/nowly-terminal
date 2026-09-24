import { afterEach, expect, test } from 'vitest';
import { TerminalHost } from '../src/server/host.js';
const hosts: TerminalHost[] = [];
function host() { const h = new TerminalHost({shell:'/bin/sh',args:[],cwd:process.cwd()}); hosts.push(h); return h; }
afterEach(async()=>{for(const h of hosts.splice(0)) await h.dispose();});
test('idempotent create, real shell, resize, attach and explicit close', async()=>{
 const h=host(); const first=h.create({id:'one',cols:80,rows:24});
 expect(h.create({id:'one'}).pid).toBe(first.pid); expect(h.list()).toHaveLength(1);
 h.write('one',"printf '\\033[31mMARKER_%s\\033[0m\\n' OK\r");
 await expect.poll(async()=> (await h.snapshot('one')).ansi).toContain('MARKER_OK');
 await h.resize('one',100,30); expect((await h.snapshot('one')).cols).toBe(100);
 const events: unknown[]=[]; const detach=await h.attach('one',e=>events.push(e));
 expect(events[0]).toMatchObject({type:'snapshot',sessionId:'one'}); detach();
 expect(h.list()[0].pid).toBe(first.pid); await h.close('one'); expect(h.list()).toEqual([]);
 await expect(h.snapshot('one')).rejects.toThrow('Unknown session');
});
test('exit preserves screen and never implicitly respawns',async()=>{
 const h=host();const info=h.create({id:'exit'});h.write('exit',"printf 'DONE'; exit 7\r");
 await expect.poll(()=>h.list()[0].status).toBe('exited');
 expect((await h.snapshot('exit')).ansi).toContain('DONE');expect(h.create({id:'exit'}).pid).toBe(info.pid);
 expect(h.list()[0].exitCode).toBe(7);
});
test('host limits and dimensions reject invalid work',()=>{
 const h=new TerminalHost({maxSessions:1,shell:'/bin/sh',args:[]});hosts.push(h);
 expect(()=>h.create({id:'bad',cols:0})).toThrow();h.create({id:'good'});
 expect(()=>h.create({id:'second'})).toThrow('limit');
});
