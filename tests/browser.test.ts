import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOperation } from '../src/browser.js';
import { runInNewContext } from 'node:vm';

test('P4 SIMULATED restored menu: delayed mount, retained expansion, stable App identity and quota stop',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});try{
    const page=await browser.newPage();await page.setContent(`<div id="surface">Chat</div><button id="trigger" aria-expanded="false">Thinking</button><div id="menu" hidden><span id="effort">Pro</span><button id="expand">Models</button><div id="options" hidden><button class="option" aria-checked="true">Latest</button></div></div><div inert><button class="option" aria-checked="true">Old</button></div><div id="composer" contenteditable="true"><span app-mention-path="app://asdk_app_fixture">mutou-relay</span></div><button id="send">Send</button><div class="user">msg marker</div><script>
    const t=document.querySelector('#trigger'),m=document.querySelector('#menu');t.onclick=()=>{if(t.getAttribute('aria-expanded')==='true'){m.hidden=true;t.setAttribute('aria-expanded','false');}else{const reset=m.hidden;t.setAttribute('aria-expanded','true');setTimeout(()=>{m.hidden=false;if(reset){document.querySelector('#effort').hidden=false;document.querySelector('#expand').hidden=false;document.querySelector('#options').hidden=true;}},50);}};
    document.querySelector('#expand').onclick=()=>{document.querySelector('#options').hidden=false;document.querySelector('#expand').hidden=true;document.querySelector('#effort').hidden=true;};document.addEventListener('keydown',e=>{if(e.key==='Escape'){t.setAttribute('aria-expanded','false');setTimeout(()=>m.hidden=true,50);}});</script>`);
    const url='https://chatgpt.com/c/restored-fixture',host={url:()=>url,locator:page.locator.bind(page),keyboard:page.keyboard};
    const spec:any={conversation_url:url,app_uri:'app://asdk_app_fixture',reasoning_in_menu:true,selectors:{surface:'#surface',model:'.option[aria-checked="true"]:not([inert] *):visible',model_trigger:'#trigger',model_expand:'#expand',model_options:'.option:not([inert] *):visible',reasoning:'#effort:visible',app:'[app-mention-path]',composer:'#composer',send:'#send',stop:'.stop',errors:'.error',user_messages:'.user',assistant_messages:'.assistant',tool_evidence:'.tool'},operation:'inspect_chat_surface'};
    const observed:any=await browserOperation(host,spec);assert.equal(observed.app_available,true);assert.equal(observed.reasoning_label,'Pro');
    await page.locator('#trigger').click();
    await page.locator('#expand').click();
    const preferred:any=await browserOperation(host,{...spec,operation:'apply_model_policy',policy:{mode:'prefer',preferred_labels:['Missing','Latest']}});assert.equal(preferred.selected_label,'Latest');
    await assert.rejects(browserOperation(host,{...spec,operation:'apply_model_policy',policy:{mode:'exact',exact_label:'Missing'}}),/MODEL_NOT_AVAILABLE/);
    await page.locator('[app-mention-path]').evaluate(e=>{e.setAttribute('app-mention-path','app://asdk_app_wrong');e.textContent='Mutou Relay';});
    await assert.rejects(browserOperation(host,{...spec,operation:'ensure_app_available'}),/CHATGPT_APP_UNAVAILABLE/);
    await page.locator('body').evaluate(e=>e.insertAdjacentHTML('beforeend','<div class="error" role="alert">Usage limit reached</div>'));
    await assert.rejects(browserOperation(host,{...spec,operation:'wait_for_completion',model_label:'Latest',reasoning_label:'Pro',message_id:'msg',marker:'marker'}),/BROWSER_ERROR_OR_LIMIT/);
    assert.equal(await page.locator('.user').count(),1);
  }finally{await browser.close();}
});

test('P4 SIMULATED Chat DOM in real Windows Edge: model, send dedupe, completion, UI drift',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});try{
    const page=await browser.newPage();await page.setContent(`<div id="surface">Chat</div><button id="model">Model A</button><button class="option">Model A</button><button class="option">Model B</button><div id="app">Mutou Relay</div><div id="composer" contenteditable="true"></div><button id="send">Send</button><button id="stop" hidden>Stop</button><div id="messages"></div><div class="tool">relay_read_text</div><script>
    document.querySelectorAll('.option').forEach(b=>b.onclick=()=>document.querySelector('#model').textContent=b.textContent);
    document.querySelector('#send').onclick=()=>{const c=document.querySelector('#composer');const m=document.createElement('div');m.dataset.messageAuthorRole='user';m.textContent=c.textContent;document.querySelector('#messages').append(m);c.textContent='';document.querySelector('#stop').hidden=false;};</script>`);
    // URL shim ONLY in this test. No real ChatGPT account/network is used.
    const url='https://chatgpt.com/c/local-fixture';const host={url:()=>url,locator:page.locator.bind(page),keyboard:page.keyboard};
    const spec:any={conversation_url:url,selectors:{surface:'#surface',model:'#model',model_options:'.option',app:'#app',composer:'#composer',send:'#send',stop:'#stop',errors:'.error',tool_evidence:'.tool'},policy:{mode:'current'},operation:'inspect_chat_surface'};
    const observed:any=await browserOperation(host,spec);assert.equal(observed.selected_label,'Model A');assert(observed.app_available);
    const selected:any=await browserOperation(host,{...spec,operation:'apply_model_policy',policy:{mode:'prefer',preferred_labels:['Missing','Model B']}});assert.equal(selected.selected_label,'Model B');
    await assert.rejects(browserOperation(host,{...spec,operation:'apply_model_policy',policy:{mode:'exact',exact_label:'Missing'}}));
    Object.assign(spec,{model_label:'Model B',reasoning_label:null,message_id:'msg-fixture',marker:'marker-fixture',message:'msg-fixture marker-fixture task'});
    assert.equal((await browserOperation(host,{...spec,operation:'send_message'}) as any).status,'SENT');
    assert.equal((await browserOperation(host,{...spec,operation:'send_message'}) as any).status,'ALREADY_SENT');
    assert.equal(await page.locator('[data-message-author-role="user"]').count(),1);
    assert.equal((await browserOperation(host,{...spec,operation:'wait_for_completion'}) as any).status,'GENERATING');
    await page.locator('#stop').evaluate(e=>(e as HTMLElement).hidden=true);await page.locator('#messages').evaluate(e=>{const a=document.createElement('div');a.dataset.messageAuthorRole='assistant';a.textContent='{"message_id":"msg-fixture","marker":"marker-fixture"}';e.append(a);});
    assert.equal((await browserOperation(host,{...spec,operation:'extract_response'}) as any).status,'COMPLETE');
    await page.locator('#model').evaluate(e=>e.textContent='Changed');await assert.rejects(browserOperation(host,{...spec,operation:'send_message'}));
  }finally{await browser.close();}
});

test('P4 observed 2026-09 Chat DOM: menu model, mention preservation, voice completion, fail closed',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});try{
    const page=await browser.newPage();await page.setContent(`<form data-chatgpt-composer data-composer-placement="thread"><button type="button" id="trigger">Pro</button><div id="composer" contenteditable="true"><span contenteditable="false" app-mention-display-name="Mutou Relay">Mutou Relay</span> </div><button type="button" id="send">Send</button><button type="button" id="stop" hidden>Stop</button><button type="button" id="voice" hidden>Voice</button></form><div id="menu" hidden><button id="expand">Select model</button><div id="options" hidden><button class="option" aria-checked="true">Latest</button><button class="option" aria-checked="false">Other</button></div></div><div id="messages"></div><script>
    document.querySelector('#trigger').onclick=()=>{document.querySelector('#menu').hidden=false;document.querySelector('#options').hidden=true;};
    document.querySelector('#expand').onclick=()=>document.querySelector('#options').hidden=false;
    document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('#menu').hidden=true;});
    document.querySelector('#send').onclick=()=>{const c=document.querySelector('#composer');const u=document.createElement('div');u.dataset.contentSearchUnitKey='turn:0:user';u.textContent=c.textContent;document.querySelector('#messages').append(u);window.mentionRetained=c.querySelector('[app-mention-display-name]')!==null;c.textContent='';document.querySelector('#stop').hidden=false;document.querySelector('#send').hidden=true;};</script>`);
    const url='https://chatgpt.com/c/observed-fixture';const host={url:()=>url,locator:page.locator.bind(page),keyboard:page.keyboard};
    const spec:any={conversation_url:url,surface_kind:'chatgpt-composer',composer_app_mention:true,selectors:{surface:'form[data-chatgpt-composer]',model:'.option[aria-checked="true"]',model_trigger:'#trigger',model_expand:'#expand',model_options:'.option',reasoning:'#trigger',app:'[app-mention-display-name="Mutou Relay"]',composer:'#composer',send:'#send',stop:'#stop',completion:'#voice',user_messages:'[data-content-search-unit-key$=":user"]',assistant_messages:'[data-markdown-text-style="assistant-message"]',errors:'.error',tool_evidence:'.tool'},operation:'inspect_chat_surface'};
    // Host sandbox has no URL global; exercise the serialized function there too.
    const observed:any=await runInNewContext('('+browserOperation.toString()+')(host,spec)',{host,spec});assert.equal(observed.selected_label,'Latest');assert.equal(observed.reasoning_label,'Pro');assert.deepEqual(Array.from(observed.available_options),['Latest','Other']);assert.equal(observed.app_available,true);
    Object.assign(spec,{model_label:'Latest',reasoning_label:'Pro',message_id:'msg-new',marker:'marker-new',message:'msg-new marker-new'});
    await page.locator('#composer').press('End');await page.keyboard.insertText('User draft');await assert.rejects(browserOperation(host,{...spec,operation:'send_message'}),/COMPOSER_NOT_EMPTY/);
    await page.locator('#composer').evaluate(e=>{e.innerHTML='<span contenteditable="false" app-mention-display-name="Mutou Relay">Mutou Relay</span> ';});
    assert.equal((await browserOperation(host,{...spec,operation:'send_message'}) as any).status,'SENT');assert.equal(await page.evaluate(()=>(window as any).mentionRetained),true);
    assert.equal((await browserOperation(host,{...spec,operation:'wait_for_completion'}) as any).status,'GENERATING');
    await page.locator('#stop').evaluate(e=>(e as HTMLElement).hidden=true);await page.locator('#voice').evaluate(e=>(e as HTMLElement).hidden=false);await page.locator('#messages').evaluate(e=>{e.insertAdjacentHTML('beforeend','<div data-markdown-text-style="assistant-message">msg-new marker-new</div>');});
    assert.equal((await browserOperation(host,{...spec,operation:'extract_response'}) as any).status,'COMPLETE');
    await page.locator('[data-markdown-text-style="assistant-message"]').evaluate(e=>{e.textContent='JSON Copy';const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=JSON.stringify({message_id:'msg-new',marker:'marker-new',command:'node -e "console.log(1)"'});pre.append(code);e.append(pre);});
    const extracted:any=await browserOperation(host,{...spec,operation:'extract_response'});assert.equal(JSON.parse(extracted.text).command,'node -e "console.log(1)"');
    assert.equal((await browserOperation(host,{...spec,operation:'send_message'}) as any).status,'ALREADY_SENT');
    await page.locator('form').evaluate(e=>e.removeAttribute('data-chatgpt-composer'));await assert.rejects(browserOperation(host,{...spec,operation:'inspect_chat_surface'}),/BROWSER_UI_CHANGED/);
  }finally{await browser.close();}
});
