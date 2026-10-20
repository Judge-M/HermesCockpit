document.getElementById("execute-prompt").addEventListener("click",()=>globalThis.hermesCockpit?.sendComposer());
    document.getElementById("composer-input").addEventListener("keydown",event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();globalThis.hermesCockpit?.sendComposer()}});
