// index.js

// =========================================================
// 1. MODULES LOAD කිරීම
// =========================================================
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay, 
    fetchLatestBaileysVersion,
    downloadContentFromMessage, 
    jidNormalizedUser,
} = require('@whiskeysockets/baileys');

// Keep-Alive Server Module
const keep_alive = require('./keep_alive'); 

// Utility Modules & Dependencies
const pino = require('pino'); 
const qrt = require('qrcode-terminal'); 
const googleIt = require('google-it'); 
const ytdl = require('ytdl-core'); 
const fs = require('fs'); 
const axios = require('axios'); 

// =========================================================
// 2. CONFIGURATION (පෙර සැකසුම්)
// =========================================================

// Bot Ownerගේ JID එක (⚠️ මෙය ඔබේ අංකයෙන් වෙනස් කරන්න)
const botOwnerJid = '947xxxxxxxxxx@s.whatsapp.net'; 

// COMMAND PREFIXES
const PREFIXES = ['.', '!']; 
const PRIMARY_PREFIX = '.'; 

// Bot Mode එක Load කිරීම
// config.json file එක නොමැති නම් default විදියට Public (false) තබයි.
let botConfig;
try {
    botConfig = JSON.parse(fs.readFileSync('./config.json'));
} catch (e) {
    botConfig = { isPrivate: false };
    fs.writeFileSync('./config.json', JSON.stringify(botConfig, null, 2));
}

// Spam Control
const SPAM_THRESHOLD = 5; 
const SPAM_INTERVAL = 5 * 60 * 1000; 
const spamMap = new Map(); 

// =========================================================
// 3. 24/7 KEEP-ALIVE SERVER එක ආරම්භ කිරීම
// =========================================================
keep_alive();

// =========================================================
// 4. BOT එකේ ප්‍රධාන ආරම්භක FUNCTION එක
// =========================================================
async function startBot() {
    console.log(`Starting WhatsApp Bot in ${botConfig.isPrivate ? 'PRIVATE' : 'PUBLIC'} Mode...`);

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys'); 
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }), 
        printQRInTerminal: true, 
        auth: state,
        browser: ['My-Advanced-Bot', 'Safari', '1.0.0'],
    });

    // =====================================================
    // 5. EVENT HANDLERS
    // =====================================================

    // 5.1. Connection Update (Login/Reconnect)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                delay(3000).then(() => startBot()); 
            } else {
                console.log('You are logged out!');
            }
        } else if (connection === 'open') {
            console.log(`✅ Bot Connected Successfully! Current Mode: ${botConfig.isPrivate ? 'PRIVATE' : 'PUBLIC'}`);
        }

        if (qr) {
            console.log('QR Code received. Please scan it now:');
            qrt.generate(qr, { small: true }); 
        }
    });

    // 5.2. Credentials Save
    sock.ev.on('creds.update', saveCreds);

    // 5.3. Messages Received Handler
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        
        const msg = chatUpdate.messages[0]; 

        if (!msg.message || msg.key.fromMe) {
            return;
        }

        const jid = msg.key.remoteJid; 
        const normalizedJid = jidNormalizedUser(jid); 
        const isOwner = normalizedJid === botOwnerJid;

        // Message Content Extraction
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        // -------------------------------------------------------------------
        // 🚨 COMMAND EXTRACTION WITH PREFIX CHECK
        // -------------------------------------------------------------------
        let isCommand = false;
        let prefix = '';

        for (const p of PREFIXES) {
            if (text.startsWith(p)) {
                isCommand = true;
                prefix = p;
                break;
            }
        }

        if (!isCommand) return; 
        
        // Command සහ Args ලබා ගැනීම
        const commandText = text.substring(prefix.length).trim();
        const command = commandText.split(' ')[0].toLowerCase(); 
        const args = commandText.substring(command.length).trim(); 
        
        console.log(`[${new Date().toLocaleTimeString()}] New Command received: "${command}"`);

        // -------------------------------------------------------------------
        // 🚨 GLOBAL MODE CHECK & OWNER COMMANDS (Priority 1)
        // -------------------------------------------------------------------

        // Private/Public වෙනස් කිරීමේ commands Ownerට පමණක් සීමා කිරීම
        if (isOwner && (command === 'private' || command === 'public')) {
            const newMode = command === 'private';
            botConfig.isPrivate = newMode;
            fs.writeFileSync('./config.json', JSON.stringify(botConfig, null, 2)); // File එකට Save කිරීම

            const status = newMode ? 'Owner-Only (Private)' : 'Public (Everyone can use)';
            await sock.sendMessage(jid, { text: `✅ *Bot Mode Updated!* Bot එක දැන් *${status}* Mode එකේ ක්‍රියාත්මක වේ.` }, { quoted: msg });
            return; 
        }
        
        // Bot එක Private Mode එකේ තිබේ නම්, Owner නොවන Message එකක් Ignore කරන්න.
        if (botConfig.isPrivate && !isOwner) {
            return;
        }

        // -------------------------------------------------------------------
        // 🚨 SPAM DETECTION AND AUTO-BLOCK (Priority 2)
        // -------------------------------------------------------------------
        const now = Date.now();
        const userData = spamMap.get(normalizedJid) || { count: 0, last: now, isBlocked: false };

        if (now - userData.last > SPAM_INTERVAL) {
            userData.count = 1;
            userData.last = now;
            userData.isBlocked = false;
        } else {
            userData.count++;
        }

        spamMap.set(normalizedJid, userData);

        if (userData.count > SPAM_THRESHOLD && !userData.isBlocked) {
            await sock.updateBlockStatus(normalizedJid, 'block'); 
            spamMap.set(normalizedJid, { ...userData, isBlocked: true }); 
            console.log(`❌ User ${normalizedJid} auto-blocked for spamming.`);
            return; 
        } else if (userData.isBlocked) {
            return; 
        }
        // -------------------------------------------------------------------
        
        // =========================================================
        // COMMANDS ලැයිස්තුව
        // =========================================================
        const commandsList = [
            { cmd: `${PRIMARY_PREFIX}menu`, desc: 'සියලුම commands පෙන්වයි.' },
            { cmd: `${PRIMARY_PREFIX}ping`, desc: 'Bot එක ක්‍රියාකාරීදැයි පරීක්ෂා කරයි (Pong!).' },
            { cmd: `${PRIMARY_PREFIX}search [ප්‍රශ්නය]`, desc: 'Google හි යමක් සොයයි.' },
            { cmd: `${PRIMARY_PREFIX}ytvid [URL]`, desc: 'YouTube වීඩියෝවක් යවයි.' },
            { cmd: `${PRIMARY_PREFIX}ytaud [URL]`, desc: 'YouTube Audio එකක් යවයි.' },
            { cmd: `${PRIMARY_PREFIX}tiktok [URL]`, desc: 'TikTok වීඩියෝවක් Watermark නැතුව යවයි.' },
            { cmd: `${PRIMARY_PREFIX}stiker`, desc: 'Image/Video එකක් Sticker එකක් බවට පත් කරයි (Quote කර යවන්න).' },
            { cmd: `${PRIMARY_PREFIX}private`, desc: 'Bot එක Private Mode එකට මාරු කරයි (Owner Only).' },
            { cmd: `${PRIMARY_PREFIX}public`, desc: 'Bot එක Public Mode එකට මාරු කරයි (Owner Only).' },
            { cmd: `${PRIMARY_PREFIX}block`, desc: 'Quote කළ user ව Bot වෙතින් block කරයි (Owner Only).' },
        ];
        // =========================================================

        // Command Switch
        switch (command) {
            case 'menu':
                let menuMessage = "📜 *Bot Command Menu* 📜\n\n";
                menuMessage += `Bot Status: ${botConfig.isPrivate ? 'PRIVATE (Owner Only)' : 'PUBLIC'}\n`;
                menuMessage += `ප්‍රධාන Prefix: *${PRIMARY_PREFIX}*\n\n`;
                menuMessage += "මෙන්න ඔබට භාවිතා කළ හැකි commands ලැයිස්තුව:\n\n";
                commandsList.forEach(c => {
                    menuMessage += `👉 *${c.cmd}*: ${c.desc}\n`;
                });
                await sock.sendMessage(jid, { text: menuMessage }, { quoted: msg });
                break;

            case 'ping':
                await sock.sendMessage(jid, { text: 'Pong! 🚀 I am running 24/7 on Replit.' }, { quoted: msg });
                break;
            
            case 'search':
                if (!args) {
                    await sock.sendMessage(jid, { text: `*⚠️ කරුණාකර සෙවීමට අවශ්‍ය දේ සඳහන් කරන්න.* උදා: \`${PRIMARY_PREFIX}search node js\`` }, { quoted: msg });
                    return;
                }
                await sock.sendMessage(jid, { text: `🔎 *${args}* සොයමින් පවතී...` }, { quoted: msg });
                try {
                    const results = await googleIt({ 'query': args, 'limit': 3 });
                    let replyText = `🌐 *Google Search Results* for *"${args}"*\n\n`;
                    results.forEach((result, index) => {
                        replyText += `*${index + 1}. ${result.title.trim()}*\n`;
                        replyText += `🔗 URL: ${result.link}\n`;
                        replyText += `_Summary: ${result.snippet.trim()}_\n\n`;
                    });
                    await sock.sendMessage(jid, { text: replyText }, { quoted: msg });

                } catch (error) {
                    await sock.sendMessage(jid, { text: '🚨 *Google Search Error:* සෙවීම අතරතුර දෝෂයක් ඇති විය.' }, { quoted: msg });
                }
                break;

            case 'ytvid':
            case 'ytaud':
                const url = args.split(' ')[0];
                if (!ytdl.validateURL(url)) {
                    await sock.sendMessage(jid, { text: '⚠️ *නිවැරදි YouTube URL එකක් දෙන්න.*' }, { quoted: msg });
                    return;
                }

                const type = command === 'ytvid' ? 'Video' : 'Audio';
                await sock.sendMessage(jid, { text: `Downloading ${type}... Please wait, this may take a moment. (Max 10MB)` }, { quoted: msg });

                try {
                    const info = await ytdl.getInfo(url);
                    const title = info.videoDetails.title.replace(/[^a-zA-Z0-9 ]/g, '');
                    
                    if (type === 'Audio') {
                        const stream = ytdl(url, { filter: 'audioonly', quality: 'lowestaudio' });
                        await sock.sendMessage(jid, { audio: { stream: stream }, mimetype: 'audio/mp4', fileName: `${title}.mp3` });
                    } else {
                        const stream = ytdl(url, { filter: format => format.container === 'mp4' && format.hasVideo && format.hasAudio, quality: 'highestvideo' });
                        await sock.sendMessage(jid, { video: { stream: stream }, mimetype: 'video/mp4', fileName: `${title}.mp4', caption: '🎥 *${title}* });
                    }
                } catch (error) {
                    await sock.sendMessage(jid, { text: '🚨 YouTube download failed. (Max file size may be an issue)' }, { quoted: msg });
                }
                break;

            case 'tiktok':
                const tiktokUrl = args.split(' ')[0];
                if (!tiktokUrl || !tiktokUrl.includes('tiktok.com')) {
                    await sock.sendMessage(jid, { text: '⚠️ *නිවැරදි TikTok URL එකක් දෙන්න.*' }, { quoted: msg });
                    return;
                }

                await sock.sendMessage(jid, { text: 'Downloading TikTok Video (No WM)...' }, { quoted: msg });
                
                try {
                    const apiResponse = await axios.get(`https://tikdown.org/api/download?url=${tiktokUrl}`);
                    const videoUrl = apiResponse.data.no_watermark_url; 

                    await sock.sendMessage(jid, { video: { url: videoUrl }, caption: '✅ TikTok Video (No WM)' });
                    
                } catch (error) {
                    await sock.sendMessage(jid, { text: '🚨 TikTok download failed. (API or URL not supported)' }, { quoted: msg });
                }
                break;
            
            case 'stiker':
            case 'sticker':
                const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                
                if (!quotedMsg || (!quotedMsg.imageMessage && !quotedMsg.videoMessage)) {
                    await sock.sendMessage(jid, { text: '🖼️ *Sticker හදන්න Image එකක්/Video එකක් Quote (Reply) කරන්න.*' }, { quoted: msg });
                    return;
                }

                await sock.sendMessage(jid, { text: 'Creating Sticker... 🎨' }, { quoted: msg });
                
                try {
                    let stream;
                    if (quotedMsg.imageMessage) {
                        stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image');
                    } else if (quotedMsg.videoMessage) {
                        stream = await downloadContentFromMessage(quotedMsg.videoMessage, 'video');
                    }
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                    
                    await sock.sendMessage(jid, { sticker: buffer });
                    
                } catch (error) {
                    await sock.sendMessage(jid, { text: '🚨 Sticker creation failed. (Video size too big or error)' }, { quoted: msg });
                }
                break;

            case 'block':
                if (!isOwner) { // Owner Check
                    await sock.sendMessage(jid, { text: '❌ *Permission Denied!* මෙම command එක Ownerට පමණි.' }, { quoted: msg });
                    return;
                }

                const targetJid = msg.message.extendedTextMessage?.contextInfo?.participant; 
                if (!targetJid) {
                    await sock.sendMessage(jid, { text: '👤 *Block කිරීමට අවශ්‍ය user ගේ message එක Quote කරන්න.*' }, { quoted: msg });
                    return;
                }
                
                await sock.updateBlockStatus(targetJid, 'block');
                await sock.sendMessage(jid, { text: `✅ User ${targetJid.split('@')[0]} successfully *Blocked*.` }, { quoted: msg });
                console.log(`Manual block: ${targetJid} blocked by owner.`);
                break;
        }
    });
}

// =========================================================
// 6. BOT එකේ ක්‍රියාකාරීත්වය ආරම්භ කිරීම
// =========================================================
startBot();
