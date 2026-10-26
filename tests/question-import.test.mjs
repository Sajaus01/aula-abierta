import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readQuestionsWorkbook,mapQuestions} from '../server/question-import.mjs';
test('real XLSX template is readable; mapping preserves questions and reports row errors',async()=>{
 const bytes=Buffer.from(readFileSync(new URL('../templates/questions.base64',import.meta.url),'utf8'),'base64');
 const book=await readQuestionsWorkbook(bytes);assert.equal(book.headers[0],'Enunciado');assert.equal(book.headers.length,13);assert.equal(book.headers[12],'Enlace de apoyo');assert.equal(book.rows.length,0);
 const rows=mapQuestions([{row:2,cells:['Pregunta','single','Uno','Dos','','','1','5']},{row:3,cells:['','single','Uno','','','','6','-1']}],{prompt:0,type:1,option1:2,option2:3,option3:4,option4:5,correct:6,points:7});
 assert.equal(rows[0].errors.length,0);assert.deepEqual(rows[0].question.correct,[0]);assert.ok(rows[1].errors.length>=3);
 await assert.rejects(readQuestionsWorkbook(Buffer.from('not a workbook')));
 await assert.rejects(readQuestionsWorkbook(Buffer.alloc(11*1024*1024)),/10 MB/);
});

test('importar respuestas manuales y ejercicios no exige opciones ni claves de selección',()=>{
 const mapping={prompt:0,type:1,option1:2,option2:3,correct:4,points:5};
 const rows=mapQuestions([
  {row:2,cells:['Explica el equilibrio','respuesta abierta','','','','3']},
  {row:3,cells:['Símbolo de la fuerza normal','corta','','','','1']},
  {row:4,cells:['Valor de la fuerza normal','numérica','','','','2']},
  {row:5,cells:['Construye la simulación y adjunta el archivo','simulación','','','','4']},
  {row:6,cells:['Ejercicio importado de una plantilla anterior','instruction','dato sobrante','','dato sobrante','2']}
 ],mapping);
 assert.deepEqual(rows.map(r=>r.question.type),['text','short','number','instruction','instruction']);
 assert.ok(rows.every(r=>r.errors.length===0));
 assert.ok(rows.every(r=>r.question.options.length===0&&r.question.correct.length===0));
 const invalid=mapQuestions([{row:7,cells:['Pregunta','single','Una','','','2']},{row:8,cells:['Pregunta','tipo desconocido','','','','2']}],mapping);
 assert.match(invalid[0].errors.join(' '),/opciones/);assert.match(invalid[1].errors.join(' '),/Tipo:/);
});
