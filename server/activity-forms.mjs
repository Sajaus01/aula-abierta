const defaults={text:true,link:true,files:true,requireText:false,requireLink:false,requireFiles:false};

// Missing settings preserve the response channels of existing assignments.
export function responseSettings(input){return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,typeof input?.[key]==='boolean'?input[key]:value]));}

export function validateResponseSettings(input,fail){
 if(input===undefined)return responseSettings();
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(defaults,key)))fail(400,'Opciones de respuesta no válidas.');
 if(Object.values(input).some(value=>typeof value!=='boolean'))fail(400,'Las opciones de respuesta deben ser verdaderas o falsas.');
 const result=responseSettings(input);
 if(!result.text&&!result.link&&!result.files)fail(400,'Permite al menos una forma de entregar la actividad.');
 for(const [required,allowed]of [['requireText','text'],['requireLink','link'],['requireFiles','files']])if(result[required]&&!result[allowed])fail(400,'Una respuesta obligatoria también debe estar permitida.');
 return result;
}

export function validateTaskResponse(settings,payload,files,final,fail){
 const values={text:payload.text,link:payload.url,files:files.length};
 const labels={text:'una respuesta escrita',link:'un enlace',files:'archivos'};
 for(const key of ['text','link','files'])if(!settings[key]&&values[key])fail(400,`Esta actividad no admite ${labels[key]}.`);
 if(!final)return;
 for(const [required,key]of [['requireText','text'],['requireLink','link'],['requireFiles','files']])if(settings[required]&&!values[key])fail(400,`Añade ${labels[key]} antes de entregar.`,'REQUIRED_RESPONSE');
}

export function isFiniteNumericAnswer(value){
 return /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(value)&&Number.isFinite(Number(value.replace(',','.')));
}
