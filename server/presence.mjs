// A live indicator describes a recently confirmed, visible tab, never merely a valid login.
export const PRESENCE_TTL=45_000;

export function setupPresence(db){
 const columns=new Set(db.prepare('PRAGMA table_info(presence)').all().map(c=>c.name));
 // Old clients used a 90-second lease. Do not carry their unconfirmed indicators into the new protocol.
 if(!columns.has('active'))db.exec('ALTER TABLE presence ADD COLUMN active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1))');
 if(!columns.has('event_seq'))db.exec('ALTER TABLE presence ADD COLUMN event_seq INTEGER NOT NULL DEFAULT 0');
}

const visibleUser=`u.active=1 AND u.account_status='active' AND u.must_change_password=0 AND NOT (COALESCE(pr.hidden,0)=1 AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role IN ('master','admin','teacher')))`;

export function activePresenceRows(db,{at=Date.now()}={}){
 const now=new Date(at).toISOString(),cutoff=new Date(at-PRESENCE_TTL).toISOString();
 return db.prepare(`SELECT s.user_id,p.course_id,p.tab_id FROM presence p JOIN sessions s ON s.token_hash=p.session_hash JOIN users u ON u.id=s.user_id LEFT JOIN profiles pr ON pr.user_id=u.id WHERE p.active=1 AND p.seen_at>? AND s.expires_at>? AND ${visibleUser}`).all(cutoff,now);
}

export function presenceOnline(db,userId,{at=Date.now()}={}){
 const now=new Date(at).toISOString(),cutoff=new Date(at-PRESENCE_TTL).toISOString();
 return Boolean(db.prepare(`SELECT 1 FROM presence p JOIN sessions s ON s.token_hash=p.session_hash JOIN users u ON u.id=s.user_id LEFT JOIN profiles pr ON pr.user_id=u.id WHERE s.user_id=? AND p.active=1 AND p.seen_at>? AND s.expires_at>? AND ${visibleUser} LIMIT 1`).get(userId,cutoff,now));
}

export function recordPresence(db,{sessionHash,tabId,courseId=null,leave=false,eventSeq,at=Date.now()}){
 const old=db.prepare('SELECT event_seq FROM presence WHERE session_hash=? AND tab_id=?').get(sessionHash,tabId);
 const sequence=eventSeq??(old?.event_seq||0)+1;
 const result=db.prepare(`INSERT INTO presence(session_hash,tab_id,course_id,seen_at,active,event_seq) VALUES(?,?,?,?,?,?) ON CONFLICT(session_hash,tab_id) DO UPDATE SET course_id=excluded.course_id,seen_at=excluded.seen_at,active=excluded.active,event_seq=excluded.event_seq WHERE excluded.event_seq>presence.event_seq`).run(sessionHash,tabId,courseId,new Date(at).toISOString(),leave?0:1,sequence);
 return {applied:result.changes>0,eventSeq:sequence};
}
