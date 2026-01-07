const API_BASE = 'https://discord.com/api/v10';
let currentAccount = null;
let ws = null;
let heartbeatInterval = null;
let currentChannel = null;
let lastSequence = null;

let messageStore = {};
let oldestMessageId = null;
let isLoadingMore = false;
let attachedFile = null;
let replyingTo = null;

let guildDataMap = new Map();
let guildFolders = []; 

const plugins = JSON.parse(localStorage.getItem('plugins')) || {
    showMeYourName: false,
    sendSeconds: false,
    messageLogger: true,
    clickAction: true
};

document.addEventListener('DOMContentLoaded', () => {
    if(localStorage.theme === 'dark' || !localStorage.theme) document.documentElement.classList.add('dark');
    const accs = JSON.parse(localStorage.getItem('accounts')) || [];
    const active = localStorage.getItem('activeAccountId');

    const list = document.getElementById('saved-accounts-list');
    if(accs.length) {
        document.getElementById('account-selection-view').classList.remove('hidden');
        document.getElementById('token-input-view').classList.add('hidden');
        accs.forEach(a => {
            const row = document.createElement('div'); row.className='flex items-center p-3 border dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-[#2b2d31] cursor-pointer';
            const av = a.avatar?`https://cdn.discordapp.com/avatars/${a.id}/${a.avatar}.png?size=64`:`https://cdn.discordapp.com/embed/avatars/${a.discriminator%5}.png`;
            row.innerHTML = `<img src="${av}" class="w-10 h-10 rounded-full mr-3"><div><div class="font-bold">${a.username}</div></div>`;
            row.onclick = () => login(a.id);
            list.appendChild(row);
        });
    } else {
        document.getElementById('token-input-view').classList.remove('hidden');
    }
    
    if(accs.length && active) login(active);

    document.getElementById('show-token-form').onclick = () => {
        document.getElementById('account-selection-view').classList.add('hidden');
        document.getElementById('token-input-view').classList.remove('hidden');
        document.getElementById('back-to-list').classList.remove('hidden');
    };
    document.getElementById('back-to-list').onclick = () => {
        document.getElementById('account-selection-view').classList.remove('hidden');
        document.getElementById('token-input-view').classList.add('hidden');
    }
    document.getElementById('login-button').onclick = async () => {
        const t = document.getElementById('token-input').value.trim();
        if(!t) return;
        const r = await fetch(API_BASE+'/users/@me', {headers:{Authorization:t}});
        if(r.ok) {
            const u = await r.json();
            const newAcc = {...u, token: t};
            const stored = JSON.parse(localStorage.getItem('accounts'))||[];
            const idx = stored.findIndex(x=>x.id===u.id);
            if(idx>-1) stored[idx]=newAcc; else stored.push(newAcc);
            localStorage.setItem('accounts', JSON.stringify(stored));
            login(u.id);
        } else {
            document.getElementById('login-error').innerText = "無効なトークンです";
        }
    };
    
    document.getElementById('message-input').onkeydown = e => { if(e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } handleInput(); };
    document.getElementById('message-input').oninput = handleInput;
    document.getElementById('send-button').onclick = sendMessage;
    document.getElementById('dm-icon').onclick = loadDMs;
    document.getElementById('cancel-reply').onclick = () => { replyingTo=null; document.getElementById('input-addons').classList.remove('flex'); document.getElementById('input-addons').classList.add('hidden'); document.getElementById('reply-bar').classList.add('hidden'); };
    document.getElementById('cancel-attachment').onclick = () => { attachedFile=null; document.getElementById('input-addons').classList.remove('flex'); document.getElementById('input-addons').classList.add('hidden'); document.getElementById('attachment-bar').classList.add('hidden'); };
    document.getElementById('file-input').onchange = e => { if(e.target.files[0]) setFile(e.target.files[0]); };
    document.getElementById('message-container').addEventListener('scroll', loadMore);
    
    document.getElementById('back-to-list-mobile').onclick = () => {
            document.getElementById('sidebar-view').classList.remove('hidden');
            document.getElementById('chat-section').classList.add('hidden');
    };
});

function login(id) {
    const accs = JSON.parse(localStorage.getItem('accounts'));
    currentAccount = accs.find(a=>a.id===id);
    if(!currentAccount) return;
    localStorage.setItem('activeAccountId', id);
    
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    
    renderUserPanel();
    loadGuilds();
    connectGateway();
}

function cleanupState() {
    if(ws) ws.close();
    currentChannel = null;
    document.getElementById('message-container').innerHTML = '';
}

async function api(path, method='GET', body=null) {
    const h = { Authorization: currentAccount.token };
    if(body && !(body instanceof FormData)) { h['Content-Type']='application/json'; body=JSON.stringify(body); }
    const r = await fetch(API_BASE+path, {method, headers:h, body});
    return r.ok ? (r.status===204?true:r.json()) : null;
}

async function loadGuilds() {
    const data = await api('/users/@me/guilds');
    if(!data) return;
    guildDataMap.clear();
    data.forEach(g => guildDataMap.set(g.id, g));
    renderGuildList(); 
}

function renderGuildList() {
    const el = document.getElementById('guild-list');
    el.innerHTML = '';
    
    if (guildFolders.length > 0) {
        guildFolders.forEach(folder => {
            if (folder.guild_ids.length === 0) return;
            if (folder.id) {
                const folderWrap = document.createElement('div');
                folderWrap.className = 'w-full flex flex-col items-center gap-[8px]';
                
                const head = document.createElement('div');
                head.className = 'folder-closed';
                const ids = folder.guild_ids;
                const validGuilds = ids.map(id => guildDataMap.get(id)).filter(Boolean);

                validGuilds.slice(0, 4).forEach(g => {
                    const icon = document.createElement('img');
                    icon.className = 'folder-icon-thumb';
                    icon.src = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/0.png`;
                    head.appendChild(icon);
                });

                const content = document.createElement('div');
                content.className = 'hidden flex-col items-center gap-[8px] mt-[8px] mb-[4px]';

                validGuilds.forEach(g => {
                    const icon = createServerIcon(g);
                    icon.classList.add('in-folder');
                    content.appendChild(icon);
                });

                head.onclick = () => {
                    const isOpen = !content.classList.contains('hidden');
                    if(isOpen) {
                        content.classList.add('hidden'); content.classList.remove('flex');
                        head.style.backgroundColor = '';
                        head.innerHTML = '';
                        validGuilds.slice(0, 4).forEach(g => {
                            const i = document.createElement('img'); i.className = 'folder-icon-thumb'; i.src = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/0.png`; head.appendChild(i);
                        });
                    } else {
                        content.classList.remove('hidden'); content.classList.add('flex');
                        head.style.backgroundColor = 'transparent';
                        head.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" class="text-gray-500"><path fill="currentColor" d="M20 7H12L10 5H4C2.9 5 2.01 5.9 2.01 7L2 19C2 20.1 2.9 21 4 21H20C21.1 21 22 20.1 22 19V9C22 7.9 21.1 7 20 7Z"/></svg>`;
                    }
                };
                folderWrap.appendChild(head);
                folderWrap.appendChild(content);
                el.appendChild(folderWrap);
            } 
            else {
                folder.guild_ids.forEach(gid => {
                    const g = guildDataMap.get(gid);
                    if(g) el.appendChild(createServerIcon(g));
                });
            }
        });
    } else {
        guildDataMap.forEach(g => el.appendChild(createServerIcon(g)));
    }
}

function createServerIcon(g) {
    const d = document.createElement('div');
    d.className = 'server-icon group';
    const iconUrl = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null;
    if(iconUrl) d.innerHTML = `<img src="${iconUrl}">`;
    else d.innerHTML = `<span class="text-xs font-bold">${g.name.substring(0,2)}</span>`;
    d.onclick = () => loadChannels(g, d);
    d.title = g.name;
    return d;
}

async function loadChannels(g, el) {
    document.querySelectorAll('.server-icon.active').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('guild-header').innerHTML = `<span class="font-bold truncate">${g.name}</span>`;
    
    const channels = await api(`/guilds/${g.id}/channels`);
    if(!channels) return;
    const list = document.getElementById('channel-list');
    list.innerHTML = '';
    
    const grouped = {};
    channels.forEach(c => { const p = c.parent_id || 'null'; if(!grouped[p]) grouped[p]=[]; grouped[p].push(c); });
    
    if(grouped['null']) {
        grouped['null'].sort((a,b)=>a.position-b.position).forEach(c => list.appendChild(createChannelItem(c)));
    }

    const cats = channels.filter(c => c.type === 4).sort((a,b)=>a.position-b.position);
    cats.forEach(cat => {
        const head = document.createElement('div');
        head.className = "flex items-center text-xs font-bold text-gray-500 hover:text-gray-300 cursor-pointer mt-4 mb-1 px-1 select-none uppercase";
        head.innerHTML = `<svg class="category-arrow w-3 h-3 mr-0.5 transition-transform" viewBox="0 0 24 24"><path fill="currentColor" d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>${cat.name}`;
        list.appendChild(head);
        
        const groupContainer = document.createElement('div');
        const children = grouped[cat.id] || [];
        children.sort((a,b)=>a.position-b.position).forEach(c => groupContainer.appendChild(createChannelItem(c)));
        list.appendChild(groupContainer);

        head.onclick = () => {
            head.classList.toggle('category-collapsed');
            groupContainer.classList.toggle('hidden');
        };
    });
}

function createChannelItem(c) {
    const d = document.createElement('div');
    if (![0,2,5].includes(c.type)) return document.createElement('span'); 
    d.className = `channel-item px-2 py-1 mx-2 flex items-center cursor-pointer text-md select-none ${c.type===2?'opacity-60':''}`;
    d.id = `chan-${c.id}`;
    const icon = c.type===2 ? 
        '<svg class="w-5 h-5 mr-1.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>' : 
        '<svg class="w-5 h-5 mr-1.5 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39657 3.41262C8.45094 3.10635 8.68651 2.82518 8.99761 2.82518H10.6126C10.9069 2.82518 11.1342 3.07663 11.0826 3.36706L10.4501 7H14.86L15.4966 3.41262C15.551 3.10635 15.7866 2.82518 16.0976 2.82518H17.7126C18.0069 2.82518 18.2342 3.07663 18.1826 3.36706L17.5501 7H20.7949C21.1055 7 21.341 7.28023 21.2874 7.58619L21.1124 8.58619C21.0706 8.82544 20.8628 9 20.6199 9H17.1901L16.1301 15H19.5349C19.8455 15 20.081 15.2802 20.0274 15.5862L19.8524 16.5862C19.8106 16.8254 19.6028 17 19.3599 17H15.7801L15.1435 20.5874C15.0891 20.8937 14.8535 21 14.5424 21H12.9274C12.6331 21 12.4058 20.7485 12.4574 20.4582L13.0901 17H8.68001L8.04344 20.5874C7.98906 20.8937 7.7535 21 7.4424 21H5.88657ZM8.86001 15H13.2701L14.3301 9H9.92001L8.86001 15Z"></path></svg>';
    d.innerHTML = `${icon}<span class="truncate">${c.name}</span>`;
    if(c.type !== 2) d.onclick = () => enterChannel(c);
    return d;
}

async function loadDMs() {
    document.querySelectorAll('.server-icon.active').forEach(e => e.classList.remove('active'));
    document.getElementById('dm-icon').classList.add('active');
    document.getElementById('guild-header').innerHTML = 'Direct Messages';
    
    const list = document.getElementById('channel-list');
    list.innerHTML = '';

    const dms = await api('/users/@me/channels');
    if(dms) {
        dms.sort((a,b)=>(b.last_message_id||0)-(a.last_message_id||0)).forEach(dm => {
            const u = dm.recipients[0];
            if(!u) return;
            const d = document.createElement('div');
            d.className = 'channel-item px-2 py-2 mx-2 flex items-center cursor-pointer gap-3';
            const av = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=32` : `https://cdn.discordapp.com/embed/avatars/${u.discriminator%5}.png`;
            d.innerHTML = `<img src="${av}" class="w-8 h-8 rounded-full"> <span class="truncate font-semibold">${u.username}</span>`;
            d.onclick = () => enterChannel(dm);
            list.appendChild(d);
        });
    }
}

async function enterChannel(c) {
    currentChannel = c;
    document.querySelectorAll('.channel-item').forEach(e=>e.classList.remove('active'));
    if(document.getElementById(`chan-${c.id}`)) document.getElementById(`chan-${c.id}`).classList.add('active');
    
    document.getElementById('header-channel-name').innerText = c.name || (c.recipients?c.recipients[0].username:"Channel");
    
    if(window.innerWidth < 768) {
        document.getElementById('sidebar-view').classList.add('hidden');
        document.getElementById('chat-section').classList.remove('hidden');
    }

    const con = document.getElementById('message-container');
    con.innerHTML = '';
    oldestMessageId = null;

    const msgs = await api(`/channels/${c.id}/messages?limit=50`);
    if(msgs && msgs.length) {
        oldestMessageId = msgs[msgs.length-1].id;
        renderBatch(msgs.reverse());
        // 【修正】スムーズスクロール無効で即時スクロール（ちらつき防止）
        con.scrollTop = con.scrollHeight;
    }
}

async function loadMore() {
    const con = document.getElementById('message-container');
    if(con.scrollTop === 0 && oldestMessageId && !isLoadingMore) {
        isLoadingMore = true;
        const prevH = con.scrollHeight;
        const msgs = await api(`/channels/${currentChannel.id}/messages?limit=50&before=${oldestMessageId}`);
        if(msgs && msgs.length) {
            oldestMessageId = msgs[msgs.length-1].id;
            renderBatch(msgs.reverse(), true);
            con.scrollTop = con.scrollHeight - prevH;
        } else oldestMessageId = null;
        isLoadingMore = false;
    }
}

function renderBatch(msgs, prepend=false) {
    const con = document.getElementById('message-container');
    const frag = document.createDocumentFragment();
    let lastId = null, lastTime = 0;
    
    msgs.forEach((m, i) => {
        let grouped = false;
        if(i > 0 && lastId === m.author.id && !m.referenced_message && (new Date(m.timestamp) - lastTime < 300000)) grouped = true;
        
        const el = createMsgEl(m, grouped);
        frag.appendChild(el);
        
        lastId = m.author.id;
        lastTime = new Date(m.timestamp).getTime();
    });

    if(prepend) con.prepend(frag);
    else con.appendChild(frag);
}

function createMsgEl(m, grouped) {
    let html = parseContent(m.content);
    
    // 【修正】本文復元＋deletedタグ
    if(m.deleted) { 
        html += '<span class="deleted-text">(deleted)</span>';
    }

    const date = new Date(m.timestamp);
    const timeShort = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    const isMe = currentAccount && m.author.id === currentAccount.id;
    
    let attachHTML = '';
    if(m.attachments && m.attachments.length) {
        m.attachments.forEach(a => {
            const cl = m.deleted ? 'deleted-img' : '';
            if(a.content_type?.startsWith('image')) {
                attachHTML += `<div class="mt-1"><a href="${a.url}" target="_blank"><img src="${a.url}" class="max-w-[320px] max-h-[320px] rounded object-contain ${cl}"></a></div>`;
            } else {
                attachHTML += `<div class="mt-1 p-3 bg-[#2b2d31] border border-[#26272d] rounded w-fit flex gap-2"><div class="text-[#5865f2] text-xl">📄</div><a href="${a.url}" target="_blank" class="text-[#00b0f4] hover:underline">${a.filename}</a></div>`;
            }
        });
    }

    const div = document.createElement('div');
    div.id = `msg-${m.id}`;
    div.className = `message-group px-4 ${grouped ? 'grouped' : ''} hover:bg-black/5 dark:hover:bg-white/5 pr-2`;
    if (m.mentions && m.mentions.find(u => u.id === currentAccount.id)) div.classList.add('mention-highlight');

    const tool = document.createElement('div');
    tool.className = "message-toolbar absolute right-4 -top-2 rounded flex shadow-sm z-10 px-1";
    tool.innerHTML = `<div class="p-1 hover:bg-gray-200 dark:hover:bg-[#404249] cursor-pointer rounded text-gray-400 hover:text-gray-200" onclick="replyMsg('${m.id}','${m.author.username}')"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg></div>
    ${isMe ? `<div class="p-1 hover:bg-gray-200 dark:hover:bg-[#404249] cursor-pointer rounded text-red-400 hover:text-red-500" onclick="delMsg('${m.id}')"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></div>` : ''}`;
    
    if(grouped) {
        div.innerHTML = `<div class="flex relative"><div class="w-[50px] text-[10px] text-gray-500 text-right mr-3 mt-1.5 opacity-0 group-hover:opacity-100 select-none">${timeShort}</div><div class="flex-1 w-full overflow-hidden"><div class="message-content text-[#dbdee1] leading-6">${html} ${m.edited_timestamp?'<span class="text-[10px] text-gray-500">(edited)</span>':''}</div>${attachHTML}</div></div>`;
        div.prepend(tool);
    } else {
        const nick = m.member?.nick || m.author.global_name || m.author.username;
        const av = m.member?.avatar ? `https://cdn.discordapp.com/guilds/${currentChannel.guild_id}/users/${m.author.id}/avatars/${m.member.avatar}.png?size=64` : (m.author.avatar?`https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=64`:`https://cdn.discordapp.com/embed/avatars/${m.author.discriminator%5}.png`);
        
        let deco = '';
        if(m.author.avatar_decoration_data) {
            // 【修正】サイズを標準化、はみ出しをやめてコンテナ内に収める
            deco = `<img src="https://cdn.discordapp.com/avatar-decoration-presets/${m.author.avatar_decoration_data.asset}.png?size=96" class="absolute top-0 left-0 w-full h-full pointer-events-none z-20">`;
        }

        let refEl = '';
        if(m.referenced_message) {
            const r = m.referenced_message;
            const rn = r.author?.global_name || r.author?.username || "Unknown";
            const ra = r.author?.avatar ? `https://cdn.discordapp.com/avatars/${r.author.id}/${r.author.avatar}.png?size=16` : `https://cdn.discordapp.com/embed/avatars/0.png`;
            refEl = `<div class="flex items-center ml-12 mb-1 opacity-60 text-xs hover:opacity-100 cursor-pointer relative" onclick="scrollToId('${r.id}')"><div class="reply-spine"></div><img src="${ra}" class="w-4 h-4 rounded-full mr-1 font-bold"> <span class="mr-1 font-bold text-gray-300">${rn}</span> <span class="truncate">${r.content||'Click to see'}</span></div>`;
        }

        div.innerHTML = `${refEl}<div class="flex relative mt-0.5"><div class="absolute left-0 w-10 h-10 cursor-pointer hover:shadow-lg active:translate-y-[1px] rounded-full bg-gray-600 overflow-hidden"><img src="${av}" class="w-full h-full rounded-full relative z-10">${deco}</div><div class="ml-12 w-full"><div class="flex items-center"><span class="font-medium text-white mr-2 cursor-pointer hover:underline" ${m.member?.color?`style="color:#${m.member.color.toString(16).padStart(6,'0')}"`:''}>${nick}</span><span class="text-xs text-gray-400">${plugins.sendSeconds ? date.toLocaleTimeString() : timeShort}</span></div><div class="message-content text-[#dbdee1] leading-6">${html} ${m.edited_timestamp?'<span class="text-[10px] text-gray-500">(edited)</span>':''}</div>${attachHTML}</div></div>`;
        div.prepend(tool);
    }
    return div;
}

function parseContent(txt) {
    if(!txt) return '';
    let d = txt.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    d = d.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="text-[#00b0f4] hover:underline">$1</a>');
    d = d.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    d = d.replace(/&lt;@!?(\d+)&gt;/g, (m, id) => `<span class="mention">@${id}</span>`);
    d = d.replace(/\n/g, '<br>');
    return d;
}

async function sendMessage() {
    if(!currentChannel) return;
    const ta = document.getElementById('message-input');
    const txt = ta.value.trim();
    if(!txt && !attachedFile) return;

    const tempId = 'tmp-'+Date.now();
    const now = new Date();
    
    let body = { content: txt, tts: false };
    if (replyingTo) body.message_reference = { message_id: replyingTo };
    
    const req = { method:'POST' };
    
    if (attachedFile) {
        const fd = new FormData();
        fd.append('payload_json', JSON.stringify(body));
        fd.append('files[0]', attachedFile);
        req.body = fd;
        attachedFile = null; 
        document.getElementById('input-addons').classList.add('hidden'); document.getElementById('input-addons').classList.remove('flex');
        document.getElementById('attachment-bar').classList.add('hidden');
    } else {
        req.headers = { 'Content-Type': 'application/json' };
        req.body = JSON.stringify(body);
    }

    req.headers = { ...req.headers, Authorization: currentAccount.token };

    renderBatch([{
        id: tempId, author: currentAccount, content: txt, timestamp: now.toISOString(),
        member: { avatar: currentAccount.avatar, color: null }, 
        attachments: [] 
    }], false);
    
    const con = document.getElementById('message-container');
    con.scrollTop = con.scrollHeight;

    ta.value=''; handleInput();
    
    replyingTo=null; document.getElementById('input-addons').classList.add('hidden'); document.getElementById('input-addons').classList.remove('flex');document.getElementById('reply-bar').classList.add('hidden');

    await fetch(API_BASE+`/channels/${currentChannel.id}/messages`, req);
}

async function delMsg(id) {
    if(confirm('削除しますか？')) await api(`/channels/${currentChannel.id}/messages/${id}`, 'DELETE');
}

function replyMsg(id, user) {
    replyingTo = id;
    document.getElementById('input-addons').classList.remove('hidden'); 
    document.getElementById('input-addons').classList.add('flex');
    document.getElementById('reply-bar').classList.remove('hidden');
    document.getElementById('reply-bar').classList.add('flex');
    document.getElementById('reply-to-name').innerText = user;
    document.getElementById('message-input').focus();
}

function setFile(f) {
    attachedFile = f;
    document.getElementById('input-addons').classList.remove('hidden'); 
    document.getElementById('input-addons').classList.add('flex');
    document.getElementById('attachment-bar').classList.remove('hidden');
    document.getElementById('attachment-bar').classList.add('flex');
    document.getElementById('filename-preview').innerText = f.name;
}

function scrollToId(id) {
    const el = document.getElementById(`msg-${id}`);
    if(el) {
        el.scrollIntoView({behavior:'smooth', block:'center'});
        el.classList.add('flash-highlight');
    }
}

function handleInput() {
    const t = document.getElementById('message-input');
    t.style.height='auto'; t.style.height=t.scrollHeight+'px';
    const b = document.getElementById('send-button');
    b.disabled = (!t.value.trim().length && !attachedFile);
}

function connectGateway() {
    ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
    ws.onmessage = async (e) => {
        const p = JSON.parse(e.data);
        if(p.t === 'READY') {
            if(p.d.user_settings && p.d.user_settings.guild_folders) {
                guildFolders = p.d.user_settings.guild_folders;
                renderGuildList();
            }
        }
        if(p.t === 'MESSAGE_CREATE') {
            if(p.d.channel_id === currentChannel?.id) {
                // Remove temp message if any (assuming optimistic)
                // Real usage would match nonce
                renderBatch([p.d], false);
                const con = document.getElementById('message-container');
                if (con.scrollHeight - con.scrollTop - con.clientHeight < 200) con.scrollTop = con.scrollHeight;
            }
        }
        if(p.t === 'MESSAGE_DELETE') {
            if(p.d.channel_id === currentChannel?.id) {
                const div = document.getElementById(`msg-${p.d.id}`);
                if(div) {
                    if(plugins.messageLogger) {
                         // 【修正】本文復元ではなくタグ追加
                         const c = div.querySelector('.message-content');
                         if(c) {
                             if(!c.innerHTML.includes('deleted-text')) c.insertAdjacentHTML('beforeend', '<span class="deleted-text">(deleted)</span>');
                         }
                         div.querySelectorAll('img').forEach(i => {
                             if(!i.src.includes('avatar') && !i.src.includes('decoration')) i.classList.add('deleted-img');
                         });
                    } else {
                        div.remove();
                    }
                }
            }
        }
        if(p.op === 10) {
            heartbeatInterval = setInterval(()=>ws.send(JSON.stringify({op:1, d:null})), p.d.heartbeat_interval);
            ws.send(JSON.stringify({
                op: 2,
                d: {
                    token: currentAccount.token,
                    properties: { os: "windows", browser: "chrome", device: "" }
                }
            }));
        }
    };
}

function renderUserPanel() {
    document.getElementById('current-username').innerText = currentAccount.username;
    document.getElementById('current-discriminator').innerText = currentAccount.discriminator==='0'?'':('#'+currentAccount.discriminator);
    
    const av = currentAccount.avatar ? `https://cdn.discordapp.com/avatars/${currentAccount.id}/${currentAccount.avatar}.png?size=128` : `https://cdn.discordapp.com/embed/avatars/0.png`;
    document.getElementById('current-avatar').innerHTML = `<img src="${av}" class="w-full h-full object-cover">`;
    
    const accs = JSON.parse(localStorage.getItem('accounts'));
    document.getElementById('account-list-dropdown').innerHTML = accs.map(a => `<div onclick="login('${a.id}');document.getElementById('account-switcher').classList.add('hidden')" class="p-2 flex items-center gap-2 hover:bg-gray-200 dark:hover:bg-[#35373c] rounded cursor-pointer text-sm font-semibold"><img class="w-5 h-5 rounded-full" src="${a.avatar?`https://cdn.discordapp.com/avatars/${a.id}/${a.avatar}.png?size=32`:'https://cdn.discordapp.com/embed/avatars/0.png'}">${a.username}</div>`).join('');
}

function setTheme(m){
    if(m==='dark') document.documentElement.classList.add('dark'); else document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', m);
}
function renderPluginList() {
    const l = document.getElementById('plugin-list');
    l.innerHTML = '';
    Object.keys(plugins).forEach(k => {
        const r = document.createElement('div');
        r.className = 'flex items-center justify-between p-2';
        r.innerHTML = `<span>${k}</span><label class="switch"><input type="checkbox" ${plugins[k]?'checked':''}><span class="slider"></span></label>`;
        r.querySelector('input').onchange = (e) => {
            plugins[k] = e.target.checked;
            localStorage.setItem('plugins', JSON.stringify(plugins));
        };
        l.appendChild(r);
    });
}
