import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readQuestionsWorkbook,mapQuestions} from '../server/question-import.mjs';
test('real XLSX template is readable; mapping preserves questions and reports row errors',async()=>{
 const bytes=Buffer.from(readFileSync(new URL('../templates/questions.base64',import.meta.url),'utf8'),'base64');
 const book=await readQuestionsWorkbook(bytes);assert.equal(book.headers[0],'Enunciado');assert.equal(book.headers.length,11);assert.equal(book.rows.length,0);
 const rows=mapQuestions([{row:2,cells:['Pregunta','single','Uno','Dos','','','1','5']},{row:3,cells:['','single','Uno','','','','6','-1']}],{prompt:0,type:1,option1:2,option2:3,option3:4,option4:5,correct:6,points:7});
 assert.equal(rows[0].errors.length,0);assert.deepEqual(rows[0].question.correct,[0]);assert.ok(rows[1].errors.length>=3);
 await assert.rejects(readQuestionsWorkbook(Buffer.from('not a workbook')));
 await assert.rejects(readQuestionsWorkbook(Buffer.alloc(3*1024*1024)),/2 MB/);
});
