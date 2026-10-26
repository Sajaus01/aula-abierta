/* Preserve legacy message identities while making a conversation belong to its people. */
export function migrateChatIdentity(db){
 const all=(s,...p)=>db.prepare(s).all(...p),run=(s,...p)=>db.prepare(s).run(...p);
 db.exec('BEGIN IMMEDIATE');
 try{
  if(!all('PRAGMA table_info(chat_messages)').some(c=>c.name==='course_id'))db.exec('ALTER TABLE chat_messages ADD COLUMN course_id TEXT REFERENCES courses(id) ON DELETE CASCADE');
  db.exec(`
   CREATE TABLE IF NOT EXISTS chat_conversation_groups(conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,deleted_at TEXT,deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL,PRIMARY KEY(conversation_id,course_id));
   CREATE TABLE IF NOT EXISTS chat_conversation_aliases(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE);
   CREATE TABLE IF NOT EXISTS chat_message_reads(message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,read_at TEXT NOT NULL,PRIMARY KEY(message_id,user_id));
   CREATE TABLE IF NOT EXISTS chat_legacy_members(conversation_id TEXT NOT NULL,user_id TEXT NOT NULL,canonical_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,course_id TEXT,read_id INTEGER NOT NULL,hidden_id INTEGER NOT NULL,archived INTEGER NOT NULL,muted INTEGER NOT NULL,PRIMARY KEY(conversation_id,user_id));
   CREATE TABLE IF NOT EXISTS chat_legacy_keys(message_id INTEGER PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,conversation_id TEXT NOT NULL,client_key TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS chat_identity_migrations(id INTEGER PRIMARY KEY CHECK(id=1));
  `);
  // Do this only once: replaying old read watermarks on each startup would invent receipts.
  if(!db.prepare('SELECT 1 FROM chat_identity_migrations WHERE id=1').get()){
   db.exec(`
    UPDATE chat_messages SET course_id=(SELECT course_id FROM chat_conversations WHERE id=conversation_id) WHERE course_id IS NULL;
    INSERT OR IGNORE INTO chat_conversation_groups SELECT id,course_id,deleted_at,deleted_by FROM chat_conversations;
    INSERT OR IGNORE INTO chat_legacy_members SELECT m.conversation_id,m.user_id,m.conversation_id,v.course_id,m.read_id,m.hidden_id,m.archived,m.muted FROM chat_members m JOIN chat_conversations v ON v.id=m.conversation_id;
    INSERT OR IGNORE INTO chat_legacy_keys SELECT id,conversation_id,client_key FROM chat_messages;
    INSERT OR IGNORE INTO chat_message_reads SELECT m.id,p.user_id,'' FROM chat_messages m JOIN chat_members p ON p.conversation_id=m.conversation_id WHERE m.id<=p.read_id AND m.sender_id<>p.user_id;
   `);
   const pairs=new Map();
   for(const v of all('SELECT * FROM chat_conversations ORDER BY created_at,id')){const key=v.user_a+'\0'+v.user_b;if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(v);}
   for(const rows of pairs.values()){
    const canonical=rows[0],ids=rows.map(v=>v.id),members=ids.flatMap(id=>all('SELECT * FROM chat_members WHERE conversation_id=?',id)),lastByConversation=new Map(ids.map(id=>[id,db.prepare('SELECT COALESCE(MAX(id),0) n FROM chat_messages WHERE conversation_id=?').get(id).n]));
    const keys=new Set();
    for(const v of rows){
     for(const m of all('SELECT id,sender_id,client_key FROM chat_messages WHERE conversation_id=? ORDER BY id',v.id)){
      const key=m.sender_id+'\0'+m.client_key;
      if(keys.has(key)){
       let candidate='legacy-'+m.id+'-'+m.client_key,suffix=0;
       while(keys.has(m.sender_id+'\0'+candidate)||db.prepare('SELECT 1 FROM chat_messages WHERE id<>? AND conversation_id IN ('+ids.map(()=>'?').join(',')+') AND sender_id=? AND client_key=?').get(m.id,...ids,m.sender_id,candidate))candidate='legacy-'+m.id+'-'+(++suffix)+'-'+m.client_key;
       run('UPDATE chat_messages SET client_key=? WHERE id=?',candidate,m.id);keys.add(m.sender_id+'\0'+candidate);
      }else keys.add(key);
     }
     if(v.id===canonical.id)continue;
     run('INSERT OR IGNORE INTO chat_conversation_groups SELECT ?,course_id,deleted_at,deleted_by FROM chat_conversation_groups WHERE conversation_id=?',canonical.id,v.id);
     run('UPDATE chat_messages SET conversation_id=? WHERE conversation_id=?',canonical.id,v.id);
     run('UPDATE chat_conversation_aliases SET conversation_id=? WHERE conversation_id=?',canonical.id,v.id);
     run('INSERT OR REPLACE INTO chat_conversation_aliases VALUES(?,?)',v.id,canonical.id);
     run('UPDATE chat_legacy_members SET canonical_id=? WHERE canonical_id=?',canonical.id,v.id);
     run('DELETE FROM chat_conversations WHERE id=?',v.id);
    }
    for(const user of [canonical.user_a,canonical.user_b]){
     const old=members.filter(m=>m.user_id===user),read=Math.max(0,...old.map(m=>m.read_id)),hidden=old.length&&old.every(m=>m.hidden_id>=lastByConversation.get(m.conversation_id))?Math.max(...old.map(m=>m.hidden_id)):-1;
     run('INSERT INTO chat_members VALUES(?,?,?,?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET read_id=excluded.read_id,hidden_id=excluded.hidden_id,archived=excluded.archived,muted=excluded.muted',canonical.id,user,read,hidden,Number(old.length>0&&old.every(m=>m.archived)),Number(old.length>0&&old.every(m=>m.muted)));
    }
    run('UPDATE chat_conversations SET deleted_at=NULL,deleted_by=NULL WHERE id=?',canonical.id);
   }
   db.exec('DELETE FROM chat_typing; INSERT INTO chat_identity_migrations VALUES(1)');
  }
  db.exec(`
   CREATE UNIQUE INDEX IF NOT EXISTS chat_conversation_pair ON chat_conversations(user_a,user_b);
   CREATE INDEX IF NOT EXISTS chat_origin_messages ON chat_messages(course_id,conversation_id,id);
   CREATE INDEX IF NOT EXISTS chat_group_conversations ON chat_conversation_groups(course_id,conversation_id);
   CREATE TRIGGER IF NOT EXISTS chat_message_default_origin AFTER INSERT ON chat_messages WHEN NEW.course_id IS NULL BEGIN UPDATE chat_messages SET course_id=(SELECT course_id FROM chat_conversations WHERE id=NEW.conversation_id) WHERE id=NEW.id; END;
   CREATE TRIGGER IF NOT EXISTS chat_preserve_other_origins BEFORE DELETE ON courses BEGIN
    UPDATE chat_conversations SET course_id=(SELECT g.course_id FROM chat_conversation_groups g WHERE g.conversation_id=chat_conversations.id AND g.course_id<>OLD.id ORDER BY g.course_id LIMIT 1) WHERE course_id=OLD.id AND EXISTS(SELECT 1 FROM chat_conversation_groups g WHERE g.conversation_id=chat_conversations.id AND g.course_id<>OLD.id);
   END;
  `);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
