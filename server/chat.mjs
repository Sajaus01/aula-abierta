import {migrateChatIdentity} from './chat-identity.mjs';
export {createChat} from './chat-service.mjs';

export function setupChat(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS chat_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)));
 INSERT OR IGNORE INTO chat_settings VALUES(1,1);
 CREATE TABLE IF NOT EXISTS chat_courses(course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,enabled INTEGER NOT NULL DEFAULT 0,student_staff INTEGER NOT NULL DEFAULT 1,student_peers INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS chat_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,accept_students INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS chat_conversations(id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL,deleted_at TEXT,deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL,UNIQUE(course_id,user_a,user_b),CHECK(user_a<user_b));
 CREATE TABLE IF NOT EXISTS chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TEXT NOT NULL,edited_at TEXT,deleted_at TEXT,reply_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,client_key TEXT NOT NULL,UNIQUE(conversation_id,sender_id,client_key));
 CREATE INDEX IF NOT EXISTS chat_message_conversation ON chat_messages(conversation_id,id);
 CREATE INDEX IF NOT EXISTS chat_message_sender ON chat_messages(sender_id,created_at);
 CREATE INDEX IF NOT EXISTS chat_conversation_a ON chat_conversations(user_a,course_id);
 CREATE INDEX IF NOT EXISTS chat_conversation_b ON chat_conversations(user_b,course_id);
 CREATE TABLE IF NOT EXISTS chat_members(conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,read_id INTEGER NOT NULL DEFAULT 0,hidden_id INTEGER NOT NULL DEFAULT -1,archived INTEGER NOT NULL DEFAULT 0,muted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(conversation_id,user_id));
 CREATE TABLE IF NOT EXISTS chat_edits(id INTEGER PRIMARY KEY AUTOINCREMENT,message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,body TEXT NOT NULL,changed_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS chat_typing(conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL,PRIMARY KEY(conversation_id,user_id));
 CREATE TABLE IF NOT EXISTS chat_blocks(course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(course_id,user_id));
 CREATE TABLE IF NOT EXISTS chat_reports(id TEXT PRIMARY KEY,message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,reason TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT,UNIQUE(message_id,reporter_id));`);
 migrateChatIdentity(db);
}

