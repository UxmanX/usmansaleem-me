export async function withDisabledButton(button,task){button.disabled=true;try{return await task();}finally{button.disabled=false;}}
