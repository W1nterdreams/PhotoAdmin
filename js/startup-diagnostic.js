(function () {
  "use strict";
  var began=Date.now(), records=[], lastStage="Загрузка страницы", warningTimer=null;
  var methods={};
  function elapsed(){return "+"+Math.round((Date.now()-began)/1000)+"с ";}
  function log(line){records.push(elapsed()+line);if(records.length>100)records.shift();draw();}
  function draw(){
    var box=document.getElementById("photoAdminDiag");if(!box)return;
    document.getElementById("photoAdminDiagStage").textContent=lastStage;
    document.getElementById("photoAdminDiagLog").textContent=records.slice(-35).join("\n");
  }
  function stage(name){lastStage=name;log("→ "+name);clearTimeout(warningTimer);
    warningTimer=setTimeout(function(){log("⚠ Нет завершения этапа более 15 секунд: "+name+" (запрос не прерван)");},15000);
  }
  function describeBridge(){
    var b=window.vkBridge;
    return "Среда: AndroidBridge="+(typeof window.AndroidBridge!=="undefined")+
      ", webkit="+!!(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.VKWebAppClose)+
      ", ReactNativeWebView="+!!(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage)+
      ", iframe="+(window.parent!==window)+
      ", vkBridge="+!!b+
      ", send="+!!(b&&typeof b.send==="function")+
      ", isWebView="+(b&&typeof b.isWebView==="function"?b.isWebView():"неизвестно")+
      ", isIframe="+(b&&typeof b.isIframe==="function"?b.isIframe():"неизвестно");
  }
  function attachBridge(){
    var b=window.vkBridge;
    if(!b||typeof b.send!=="function"){log("✖ vkBridge.send не найден");return;}
    if(b.__photoAdminDiagWrapped)return;
    try{
      var original=b.send.bind(b);
      b.send=function(method,params){
        var id=(methods[method]||0)+1;methods[method]=id;
        var started=Date.now();log("Bridge → "+method+" #"+id);
        try{
          return Promise.resolve(original(method,params)).then(function(value){
            log("Bridge ✓ "+method+" #"+id+" ("+(Date.now()-started)+" мс)");return value;
          },function(err){
            log("Bridge ✖ "+method+" #"+id+" ("+(Date.now()-started)+" мс): "+String(err&&((err.error_type||err.error_code||err.message))||"ошибка"));throw err;
          });
        }catch(err){log("Bridge ✖ синхронная ошибка "+method+": "+String(err&&err.message||err));throw err;}
      };
      b.__photoAdminDiagWrapped=true;
      log("Диагностика вызовов vkBridge.send подключена");
    }catch(err){log("Не удалось подключить диагностику Bridge: "+String(err&&err.message||err));}
    if(typeof b.subscribe==="function"){
      try{b.subscribe(function(event){
        var detail=event&&event.detail;
        if(detail&&detail.type){
          var type=String(detail.type);
          if(/VKWebAppInit|VKWebAppSettings|SetSupportedHandlers|VKWebAppGetUserInfo|VKWebAppGetAuthToken/.test(type))log("Bridge событие ← "+type);
        }
      });log("Подписка на события Bridge установлена");}
      catch(err){log("Ошибка подписки Bridge: "+String(err&&err.message||err));}
    }
  }
  function setup(){
    var box=document.createElement("div");box.id="photoAdminDiag";
    box.style.cssText="position:fixed;z-index:2147483647;left:8px;right:8px;bottom:8px;max-width:600px;margin:auto;padding:12px;background:#f8f9fa;color:#20252a;border:1px solid #9ca7b0;border-radius:10px;font:13px/1.45 Arial,sans-serif;box-shadow:0 2px 12px #0003";
    box.innerHTML='<strong>ФотоАдмин — диагностика Android / VK Bridge 59</strong><div id="photoAdminDiagStage"></div><pre id="photoAdminDiagLog" style="white-space:pre-wrap;max-height:210px;overflow:auto;margin:8px 0"></pre><button id="photoAdminDiagCopy" type="button">Скопировать журнал</button> <button id="photoAdminDiagHide" type="button">Скрыть</button>';
    document.body.appendChild(box);
    document.getElementById("photoAdminDiagCopy").onclick=function(){
      var report="ФотоАдмин: диагностика Android / VK Bridge 59\n"+records.join("\n");
      if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(report).catch(function(){prompt("Скопируйте журнал",report);});
      else prompt("Скопируйте журнал",report);
    };
    document.getElementById("photoAdminDiagHide").onclick=function(){box.style.display="none";};
    log(describeBridge());attachBridge();draw();
  }
  window.photoAdminDiagnostic={stage:stage,error:function(message){clearTimeout(warningTimer);lastStage="Ошибка запуска";log("✖ "+String(message));},done:function(){clearTimeout(warningTimer);log("✓ Запуск завершён");var b=document.getElementById("photoAdminDiag");if(b)b.style.display="none";},log:log};
  window.addEventListener("error",function(e){log("Ошибка JS/ресурса: "+String(e.message||e.filename||"неизвестно"));});
  window.addEventListener("unhandledrejection",function(e){log("Ошибка Promise: "+String(e.reason&&e.reason.message||e.reason||"неизвестно"));});
  stage("Загрузка VK Bridge и JavaScript");
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup);else setup();
})();
