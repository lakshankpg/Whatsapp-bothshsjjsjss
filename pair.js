const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const { sms, downloadMediaMessage } = require("./msg");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'false',
    AUTO_LIKE_EMOJI: ['💋', '🍬', '🫆', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/HSVSgUDY1SwBccoreYKjJ5?mode=r_c',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: './lakshan.jpg',
    NEWSLETTER_JID: '120363426375145222@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '94762731899,94707085822,9472 664 5160',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbC1S2nEquiQQ5TA1u31',
    CAPTION: '𝐏𝙾𝚆𝙴𝚁𝙳 𝐁𝚈 DXLK Mini Bot',
    
    // New Settings Configuration
    BOT_SETTINGS: {
        prefix: '.',
        language: 'en',
        mode: 'public',
        autoReply: 'on',
        autoRead: 'on',
        typingIndicator: 'on',
        autoReact: 'on',
        status: 'DXLK Mini Bot is running',
        bio: 'Powered by DXLK Mini Bot',
        menuType: 'list',
        timezone: 'GMT+5:30',
        antiSpam: 'on',
        antiLink: 'on',
        welcome: 'on',
        welcomeText: 'Welcome to the group!',
        goodbye: 'on',
        goodbyeText: 'Goodbye!',
        commandLog: 'on',
        ownerName: 'lakshan',
        ownerNumber: '94789227570',
        autoSave: 'on',
        userLimit: 50,
        cooldown: 3,
        maintenance: 'off',
        groupWelcome: 'on',
        groupGoodbye: 'on',
        botName: 'DXLK Mini Bot'
    },
    DISABLED_COMMANDS: []
};

const octokit = new Octokit({ auth: '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' });
const owner = 'lakshankpg';
const repo = 'lakshan-mini-bot';

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const SETTINGS_PATH = './bot_settings.json';
const GROUP_SETTINGS_PATH = './group_settings.json';
const otpStore = new Map();
const userCooldowns = new Map();
const groupSettings = new Map();
const spamUsers = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

// Load bot settings
function loadBotSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const savedSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            config.BOT_SETTINGS = { ...config.BOT_SETTINGS, ...savedSettings };
        }
        return config.BOT_SETTINGS;
    } catch (error) {
        console.error('Failed to load bot settings:', error);
        return config.BOT_SETTINGS;
    }
}

// Load group settings
function loadGroupSettings() {
    try {
        if (fs.existsSync(GROUP_SETTINGS_PATH)) {
            const settings = JSON.parse(fs.readFileSync(GROUP_SETTINGS_PATH, 'utf8'));
            settings.forEach(setting => {
                groupSettings.set(setting.groupId, setting);
            });
        }
    } catch (error) {
        console.error('Failed to load group settings:', error);
    }
}

// Save bot settings
function saveBotSettings() {
    try {
        if (config.BOT_SETTINGS.autoSave === 'on') {
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(config.BOT_SETTINGS, null, 2));
            console.log('Bot settings saved');
        }
    } catch (error) {
        console.error('Failed to save bot settings:', error);
    }
}

// Save group settings
function saveGroupSettings() {
    try {
        const settings = [];
        groupSettings.forEach((value, key) => {
            settings.push({ groupId: key, ...value });
        });
        fs.writeFileSync(GROUP_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error('Failed to save group settings:', error);
    }
}

// Initialize settings
loadBotSettings();
loadGroupSettings();

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

// Check if user is on cooldown
function checkCooldown(userId, command) {
    const key = `${userId}_${command}`;
    const now = Date.now();
    const cooldownTime = parseInt(config.BOT_SETTINGS.cooldown) * 1000;
    
    if (userCooldowns.has(key)) {
        const lastUsed = userCooldowns.get(key);
        if (now - lastUsed < cooldownTime) {
            const remaining = Math.ceil((cooldownTime - (now - lastUsed)) / 1000);
            return remaining;
        }
    }
    return 0;
}

// Set cooldown for user
function setCooldown(userId, command) {
    const key = `${userId}_${command}`;
    userCooldowns.set(key, Date.now());
}

// Anti-spam check
function checkSpam(userId) {
    const now = Date.now();
    const userSpamKey = `spam_${userId}`;
    
    if (spamUsers.has(userSpamKey)) {
        const { count, firstTime } = spamUsers.get(userSpamKey);
        
        // Reset if more than 1 minute passed
        if (now - firstTime > 60000) {
            spamUsers.set(userSpamKey, { count: 1, firstTime: now });
            return false;
        }
        
        // Check if exceeded limit (10 messages per minute)
        if (count >= 10) {
            return true;
        }
        
        spamUsers.set(userSpamKey, { count: count + 1, firstTime });
    } else {
        spamUsers.set(userSpamKey, { count: 1, firstTime: now });
    }
    
    return false;
}

// Add user to spam list
function addSpamUser(userId, groupId = null) {
    const spamKey = `spam_${userId}${groupId ? `_${groupId}` : ''}`;
    spamUsers.set(spamKey, { timestamp: Date.now(), count: 1 });
}

// Remove user from spam list
function removeSpamUser(userId, groupId = null) {
    const spamKey = `spam_${userId}${groupId ? `_${groupId}` : ''}`;
    spamUsers.delete(spamKey);
}

async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        const configFiles = data.filter(file => 
            file.name === `config_${sanitizedNumber}.json`
        );

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }

        if (configFiles.length > 0) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
        : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(
        ' lakshan =94789227570\n\ndineth=72 664 5160\n\nGOD SHAVIYA=94707085822',
        `📞 Number: ${number}\n🩵 Status: Connected\n my whatsapp channel \n https://whatsapp.com/channel/0029VbC1S2nEquiQQ5TA1u31`,
        '𝐏𝙾𝚆𝙴𝚁𝙳 𝐁𝚈 DXLK Mini Bot'
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.RCD_IMAGE_PATH },
                    caption
                }
            );
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        '𝐏𝙾𝚆𝙴𝚁𝙳 𝐁𝚈 DXLK Mini Bot'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['🩵', '🔥', '😀', '👍', '🐭'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            'Laki DXLK Mini Bot'
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function oneViewmeg(socket, isOwner, msg, sender) {
    if (isOwner) {  
        try {
            const akuru = sender;
            const quot = msg;
            if (quot) {
                if (quot.imageMessage?.viewOnce) {
                    console.log("View once image detected");
                    let cap = quot.imageMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot);
                    await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
                } else if (quot.videoMessage?.viewOnce) {
                    console.log("View once video detected");
                    let cap = quot.videoMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot);
                    await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
                } else if (quot.audioMessage?.viewOnce) {
                    console.log("View once audio detected");
                    let cap = quot.audioMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot);
                    await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2?.message?.imageMessage) {
                    let cap = quot.viewOnceMessageV2?.message?.imageMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot);
                    await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2?.message?.videoMessage) {
                    let cap = quot.viewOnceMessageV2?.message?.videoMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot);
                    await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2Extension?.message?.audioMessage) {
                    let cap = quot.viewOnceMessageV2Extension?.message?.audioMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot);
                    await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
                }
            }
        } catch (error) {
            console.error("Error in view once handler:", error);
        }
    }
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const quoted = type == "extendedTextMessage" && msg.message.extendedTextMessage?.contextInfo != null
            ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
            : [];
        
        const body = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
            ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') 
            ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
                && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') 
            ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') 
            ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage?.caption 
            ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage?.caption 
            ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') 
            ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') 
            ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') 
            ? (msg.message.buttonsResponseMessage?.selectedButtonId 
                || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
                || msg.text) 
            : (type === 'viewOnceMessage') 
            ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") 
            ? (msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || "") 
            : '';
        
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        
        const prefix = config.BOT_SETTINGS.prefix || config.PREFIX;
        const isCmd = body.startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
        const args = body.trim().split(/ +/).slice(1);
        
        // Helper function to reply
        const reply = async (text) => {
            await socket.sendMessage(sender, { text: text }, { quoted: msg });
        };
        
        // Check maintenance mode
        if (config.BOT_SETTINGS.maintenance === 'on' && !isOwner) {
            return await reply('🚧 Bot is under maintenance. Please try again later.');
        }
        
        // Check disabled commands
        if (config.DISABLED_COMMANDS.includes(command) && !isOwner) {
            return await reply(`❌ Command "${command}" is currently disabled.`);
        }
        
        // Check spam protection
        if (config.BOT_SETTINGS.antiSpam === 'on' && !isOwner) {
            if (checkSpam(senderNumber)) {
                return await reply('⚠️ Please slow down! You\'re sending messages too quickly.');
            }
        }
        
        // Check cooldown
        if (!isOwner) {
            const cooldownRemaining = checkCooldown(senderNumber, command);
            if (cooldownRemaining > 0) {
                return await reply(`⏳ Please wait ${cooldownRemaining} seconds before using "${command}" again.`);
            }
        }
        
        // Set cooldown
        if (!isOwner) {
            setCooldown(senderNumber, command);
        }
        
        // Check anti-link in groups
        if (isGroup && config.BOT_SETTINGS.antiLink === 'on' && !isOwner) {
            const linkPattern = /(https?:\/\/[^\s]+|www\.[^\s]+|chat\.whatsapp\.com\/[^\s]+)/gi;
            if (linkPattern.test(body)) {
                try {
                    await socket.sendMessage(from, {
                        text: `⚠️ *Link Detected!*\nLinks are not allowed in this group.\nPosted by: @${senderNumber}`,
                        mentions: [sender]
                    });
                    
                    // Optional: Delete the message with link
                    try {
                        await socket.sendMessage(from, {
                            delete: msg.key
                        });
                    } catch (deleteError) {
                        console.log('Cannot delete message:', deleteError);
                    }
                    
                    return;
                } catch (error) {
                    console.error('Anti-link error:', error);
                }
            }
        }
        
        // Auto reply for non-commands
        if (!isCmd && config.BOT_SETTINGS.autoReply === 'on' && !isOwner && !isGroup) {
            const autoReplies = {
                'hi': 'Hello! How can I help you?',
                'hello': 'Hi there! 😊',
                'how are you': 'I\'m doing great, thanks for asking!',
                'bot': 'Yes, I\'m DXLK Mini Bot! How can I assist you?'
            };
            
            const lowerBody = body.toLowerCase();
            for (const [key, replyText] of Object.entries(autoReplies)) {
                if (lowerBody.includes(key)) {
                    await socket.sendMessage(sender, { text: replyText });
                    break;
                }
            }
        }
        
        // Group welcome/goodbye handlers
        if (isGroup) {
            const groupMetadata = await socket.groupMetadata(from).catch(() => null);
            if (groupMetadata) {
                // Check for new participants (welcome)
                if (msg.message?.groupInviteMessage || msg.message?.protocolMessage?.type === 5) {
                    if (config.BOT_SETTINGS.groupWelcome === 'on') {
                        const welcomeMsg = config.BOT_SETTINGS.welcomeText || 'Welcome to the group!';
                        await socket.sendMessage(from, { 
                            text: `👋 @${senderNumber} ${welcomeMsg}`,
                            mentions: [sender]
                        });
                    }
                }
                
                // Check for leave/remove (goodbye)
                if (msg.message?.protocolMessage?.type === 8 || msg.message?.protocolMessage?.type === 9) {
                    if (config.BOT_SETTINGS.groupGoodbye === 'on') {
                        const goodbyeMsg = config.BOT_SETTINGS.goodbyeText || 'Goodbye!';
                        await socket.sendMessage(from, { 
                            text: `👋 ${goodbyeMsg}` 
                        });
                    }
                }
            }
        }
        
        socket.downloadAndSaveMediaMessage = async(message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            const FileType = require('file-type');
            let type = await FileType.fromBuffer(buffer);
            let trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };
        
        if (!command) return;
        
        // Command logging
        if (config.BOT_SETTINGS.commandLog === 'on') {
            console.log(`[COMMAND] ${senderNumber}: ${prefix}${command} ${args.join(' ')}`);
        }

        try {
            switch (command) {
                // ========== BOT SETTINGS COMMANDS ==========
                case 'settings': {
                    const settings = config.BOT_SETTINGS;
                    
                    const sections = [
                        {
                            title: '⚙️ GENERAL SETTINGS',
                            rows: [
                                { title: 'Prefix', description: `Current: ${settings.prefix}`, id: `${prefix}setprefix ` },
                                { title: 'Language', description: `Current: ${settings.language}`, id: `${prefix}setlang ` },
                                { title: 'Mode', description: `Current: ${settings.mode}`, id: `${prefix}setmode ` },
                                { title: 'Bot Name', description: `Current: ${settings.botName}`, id: `${prefix}setbotname ` }
                            ]
                        },
                        {
                            title: '🤖 AUTO FEATURES',
                            rows: [
                                { title: 'Auto Reply', description: `Current: ${settings.autoReply}`, id: `${prefix}setreply ` },
                                { title: 'Auto Read', description: `Current: ${settings.autoRead}`, id: `${prefix}setautoread ` },
                                { title: 'Typing Indicator', description: `Current: ${settings.typingIndicator}`, id: `${prefix}settyping ` },
                                { title: 'Auto Reaction', description: `Current: ${settings.autoReact}`, id: `${prefix}setreact ` }
                            ]
                        },
                        {
                            title: '🛡️ PROTECTION',
                            rows: [
                                { title: 'Anti Spam', description: `Current: ${settings.antiSpam}`, id: `${prefix}setantispam ` },
                                { title: 'Anti Link', description: `Current: ${settings.antiLink}`, id: `${prefix}setantilink ` },
                                { title: 'Group Welcome', description: `Current: ${settings.groupWelcome}`, id: `${prefix}setgroupwelcome ` },
                                { title: 'Group Goodbye', description: `Current: ${settings.groupGoodbye}`, id: `${prefix}setgroupgoodbye ` }
                            ]
                        },
                        {
                            title: '👤 PROFILE SETTINGS',
                            rows: [
                                { title: 'Bot Status', description: settings.status.slice(0, 30) + '...', id: `${prefix}setstatus ` },
                                { title: 'Bot Bio', description: settings.bio.slice(0, 30) + '...', id: `${prefix}setbio ` },
                                { title: 'Owner Name', description: `Current: ${settings.ownerName}`, id: `${prefix}setownername ` },
                                { title: 'Owner Number', description: `Current: ${settings.ownerNumber}`, id: `${prefix}setownernumber ` }
                            ]
                        },
                        {
                            title: '⚡ SYSTEM',
                            rows: [
                                { title: 'Backup Settings', description: 'Create backup', id: `${prefix}backup` },
                                { title: 'Restore Settings', description: 'Restore from backup', id: `${prefix}restore` },
                                { title: 'Reset Settings', description: 'Reset to default', id: `${prefix}resetsettings` },
                                { title: 'Maintenance Mode', description: `Current: ${settings.maintenance}`, id: `${prefix}setmaintenance ` }
                            ]
                        }
                    ];

                    const buttonMessage = {
                        buttons: [
                            {
                                buttonId: 'action',
                                buttonText: { displayText: '⚙️ Select Setting' },
                                type: 4,
                                nativeFlowInfo: {
                                    name: 'single_select',
                                    paramsJson: JSON.stringify({
                                        title: 'Bot Settings ⚙️',
                                        sections: sections
                                    })
                                }
                            }
                        ],
                        headerType: 1,
                        viewOnce: true,
                        caption: '⚙️ *DXLK Mini Bot Settings*\nSelect a setting to modify:',
                        image: { url: 'https://i.ibb.co/XfWS0SF3/89be83969ccefc24.jpg' }
                    };

                    await socket.sendMessage(from, buttonMessage, { quoted: msg });
                    break;
                }
                
                case 'setprefix': {
                    if (!isOwner) return await reply('❌ Only bot owner can change prefix!');
                    const newPrefix = args[0];
                    if (!newPrefix || newPrefix.length > 2) {
                        return await reply('❌ Please provide a valid prefix (1-2 characters)\nExample: .setprefix !');
                    }
                    config.BOT_SETTINGS.prefix = newPrefix;
                    saveBotSettings();
                    await reply(`✅ Prefix changed to: \`${newPrefix}\``);
                    break;
                }
                
                case 'setlang': {
                    if (!isOwner) return await reply('❌ Only bot owner can change language!');
                    const lang = args[0];
                    if (!['si', 'en'].includes(lang)) {
                        return await reply('❌ Invalid language! Use: si (Sinhala) or en (English)');
                    }
                    config.BOT_SETTINGS.language = lang;
                    saveBotSettings();
                    await reply(`✅ Language changed to: ${lang === 'si' ? 'Sinhala' : 'English'}`);
                    break;
                }
                
                case 'setmode': {
                    if (!isOwner) return await reply('❌ Only bot owner can change mode!');
                    const mode = args[0];
                    if (!['public', 'private'].includes(mode)) {
                        return await reply('❌ Invalid mode! Use: public or private');
                    }
                    config.BOT_SETTINGS.mode = mode;
                    saveBotSettings();
                    await reply(`✅ Bot mode changed to: ${mode}`);
                    break;
                }
                
                case 'setbotname': {
                    if (!isOwner) return await reply('❌ Only bot owner can change bot name!');
                    const name = args.join(' ');
                    if (!name) return await reply('❌ Please provide bot name!');
                    config.BOT_SETTINGS.botName = name;
                    saveBotSettings();
                    await reply(`✅ Bot name changed to: ${name}`);
                    break;
                }
                
                case 'setreply': {
                    if (!isOwner) return await reply('❌ Only bot owner can change auto reply!');
                    const state = args[0];
                    if (!['on', 'off'].includes(state)) {
                        return await reply('❌ Invalid state! Use: on or off');
                    }
                    config.BOT_SETTINGS.autoReply = state;
                    saveBotSettings();
                    await reply(`✅ Auto reply ${state === 'on' ? 'enabled' : 'disabled'}`);
                    break;
                }
                
                case 'setautoread': {
                    if (!isOwner) return await reply('❌ Only bot owner can change auto read!');
                    const state = args[0];
                    if (!['on', 'off'].includes(state)) {
                        return await reply('❌ Invalid state! Use: on or off');
                    }
                    config.BOT_SETTINGS.autoRead = state;
                    saveBotSettings();
                    await reply(`✅ Auto read ${state === 'on' ? 'enabled' : 'disabled'}`);
                    break;
                }
                
                case 'settyping': {
                    if (!isOwner) return await reply('❌ Only bot owner can change typing indicator!');
                    const state = args[0];
                    if (!['on', 'off'].includes(state)) {
                        return await reply('❌ Invalid state! Use: on or off');
                    }
                    config.BOT_SETTINGS.typingIndicator = state;
                    saveBotSettings();
                    await reply(`✅ Typing indicator ${state === 'on' ? 'enabled' : 'disabled'}`);
                    break;
                }
                
                case 'setreact': {
                    if (!isOwner) return await reply('❌ Only bot owner can change auto reaction!');
                    const state = args[0];
                    if (!['on', 'off'].includes(state)) {
                        return await reply('❌ Invalid state! Use: on or off');
                    }
                    config.BOT_SETTINGS.autoReact = state;
                    saveBotSettings();
                    await reply(`✅ Auto reaction ${state === 'on' ? 'enabled' : 'disabled'}`);
                    break;
                }
                
                case 'setstatus': {
                    if (!isOwner) return await reply('❌ Only bot owner can change bot status!');
                    const statusText = args.join(' ');
                    if (!statusText) {
                        return await reply('❌ Please provide status text!\nExample: .setstatus DXLK Bot is online');
                    }
                    config.BOT_SETTINGS.status = statusText;
                    saveBotSettings();
                    try {
                        await socket.updateProfileStatus(statusText);
                    } catch (error) {
                        console.log('Failed to update WhatsApp status:', error);
                    }
                    await reply(`✅ Bot status updated to: ${statusText}`);
                    break;
                }
                
                case 'setbio': {
                    if (!isOwner) return await reply('❌ Only bot owner can change bot bio!');
                    const bioText = args.join(' ');
                    if (!bioText) {
                        return await reply('❌ Please provide bio text!\nExample: .setbio Powered by DXLK Mini Bot');
                    }
                    config.BOT_SETTINGS.bio = bioText;
                    saveBotSettings();
                    try {
                        await socket.updateProfile(bioText);
                    } catch (error) {
                        console.log('Failed to update WhatsApp bio:', error);
                    }
                    await reply(`✅ Bot bio updated to: ${bioText}`);
                    break;
                }
                
                case 'setantispam': {
                    if (!isOwner) return await reply('❌ Only bot owner can change anti-spam!');
                    const state = args[0];
                    if (!['on', 'off'].includes(state)) {
                        return await reply('❌ Invalid state! Use: on or off');
                    }
                    config.BOT_SETTINGS.antiSpam = state;
                    saveBotSettings();
                    await reply(`✅ Anti-spam protection ${state === 'on' ? 'enabled' : 'disabled'}`);
                    break;
                }
                
                case 'setantilink': {
                    if (!isOwner) return await reply('❌ Only bot owner can change anti-link!');
                    const state = args[0];
                    if (!['on', 'off'].includes(state)) {
                        return await reply('❌ Invalid state! Use: on or off');
                    }
                    config.BOT_SETTINGS.antiLink = state;
                    saveBotSettings();
                    await reply(`✅ Anti-link protection ${state === 'on' ? 'enabled' : 'disabled'}`);
                    break;
                }
                
                case 'setgroupwelcome': {
                    if (!isOwner) return await reply('❌ Only bot owner can change group welcome!');
                    const state = args[0];
                    if (!['on', 'off'].includes(state)) {
                        return await reply('❌ Invalid state! Use: on or off');
                    }
                    config.BOT_SETTINGS.groupWelcome = state;
                    saveBotSettings();
                    await reply(`✅ Group welcome ${state === 'on' ? 'enabled' : 'disabled'}`);
                    break;
                }
                
                case 'setgroupgoodbye': {
                    if (!isOwner) return await reply('❌ Only bot owner can change group goodbye!');
                    const state = args[0];
                    if (!['on', 'off'].includes(state)) {
                        return await reply('❌ Invalid state! Use: on or off');
                    }
                    config.BOT_SETTINGS.groupGoodbye = state;
                    saveBotSettings();
                    await reply(`✅ Group goodbye ${state === 'on' ? 'enabled' : 'disabled'}`);
                    break;
                }
                
                case 'setownername': {
                    if (!isOwner) return await reply('❌ Only bot owner can change owner name!');
                    const name = args.join(' ');
                    if (!name) return await reply('❌ Please provide owner name!');
                    config.BOT_SETTINGS.ownerName = name;
                    saveBotSettings();
                    await reply(`✅ Owner name updated to: ${name}`);
                    break;
                }
                
                case 'setownernumber': {
                    if (!isOwner) return await reply('❌ Only bot owner can change owner number!');
                    const numberInput = args[0];
                    if (!numberInput || !/^\d+$/.test(numberInput)) {
                        return await reply('❌ Please provide a valid phone number!');
                    }
                    config.BOT_SETTINGS.ownerNumber = numberInput;
                    saveBotSettings();
                    await reply(`✅ Owner number updated to: ${numberInput}`);
                    break;
                }
                
                case 'setblockcmd': {
                    if (!isOwner) return await reply('❌ Only bot owner can block commands!');
                    const cmd = args[0];
                    if (!cmd) return await reply('❌ Please provide command name!\nExample: .setblockcmd tiktok');
                    if (!config.DISABLED_COMMANDS.includes(cmd)) {
                        config.DISABLED_COMMANDS.push(cmd);
                        await reply(`✅ Command "${cmd}" has been disabled`);
                    } else {
                        await reply(`ℹ️ Command "${cmd}" is already disabled`);
                    }
                    break;
                }
                
                case 'setenablecmd': {
                    if (!isOwner) return await reply('❌ Only bot owner can enable commands!');
                    const cmd = args[0];
                    if (!cmd) return await reply('❌ Please provide command name!\nExample: .setenablecmd tiktok');
                    const index = config.DISABLED_COMMANDS.indexOf(cmd);
                    if (index > -1) {
                        config.DISABLED_COMMANDS.splice(index, 1);
                        await reply(`✅ Command "${cmd}" has been enabled`);
                    } else {
                        await reply(`ℹ️ Command "${cmd}" is not disabled`);
                    }
                    break;
                }
                
                case 'setmaintenance': {
                    if (!isOwner) return await reply('❌ Only bot owner can change maintenance mode!');
                    const state = args[0];
                    if (!['on', 'off'].includes(state)) {
                        return await reply('❌ Invalid state! Use: on or off');
                    }
                    config.BOT_SETTINGS.maintenance = state;
                    saveBotSettings();
                    await reply(`✅ Maintenance mode ${state === 'on' ? 'enabled' : 'disabled'}`);
                    break;
                }
                
                case 'resetsettings': {
                    if (!isOwner) return await reply('❌ Only bot owner can reset settings!');
                    config.BOT_SETTINGS = {
                        prefix: '.',
                        language: 'en',
                        mode: 'public',
                        autoReply: 'on',
                        autoRead: 'on',
                        typingIndicator: 'on',
                        autoReact: 'on',
                        status: 'DXLK Mini Bot is running',
                        bio: 'Powered by DXLK Mini Bot',
                        menuType: 'list',
                        timezone: 'GMT+5:30',
                        antiSpam: 'on',
                        antiLink: 'on',
                        welcome: 'on',
                        welcomeText: 'Welcome to the group!',
                        goodbye: 'on',
                        goodbyeText: 'Goodbye!',
                        commandLog: 'on',
                        ownerName: 'lakshan',
                        ownerNumber: '94789227570',
                        autoSave: 'on',
                        userLimit: 50,
                        cooldown: 3,
                        maintenance: 'off',
                        groupWelcome: 'on',
                        groupGoodbye: 'on',
                        botName: 'DXLK Mini Bot'
                    };
                    config.DISABLED_COMMANDS = [];
                    saveBotSettings();
                    await reply('✅ All settings have been reset to default');
                    break;
                }
                
                case 'backup': {
                    if (!isOwner) return await reply('❌ Only bot owner can backup settings!');
                    const backupData = {
                        settings: config.BOT_SETTINGS,
                        disabledCommands: config.DISABLED_COMMANDS,
                        timestamp: new Date().toISOString()
                    };
                    const backupPath = `./backup_settings_${Date.now()}.json`;
                    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
                    await reply(`✅ Settings backed up to: ${backupPath}`);
                    break;
                }
                
                case 'restore': {
                    if (!isOwner) return await reply('❌ Only bot owner can restore settings!');
                    if (msg.message?.imageMessage || msg.message?.documentMessage) {
                        try {
                            const media = msg.message.imageMessage || msg.message.documentMessage;
                            const filePath = await socket.downloadAndSaveMediaMessage(media);
                            const backupData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                            config.BOT_SETTINGS = backupData.settings;
                            config.DISABLED_COMMANDS = backupData.disabledCommands;
                            saveBotSettings();
                            fs.unlinkSync(filePath);
                            await reply('✅ Settings restored from backup');
                        } catch (error) {
                            await reply('❌ Failed to restore backup. Invalid backup file.');
                        }
                    } else {
                        await reply('❌ Please send the backup JSON file');
                    }
                    break;
                }
                
                // ========== GROUP COMMANDS ==========
                case 'group': {
                    if (!isGroup) return await reply('❌ This command only works in groups!');
                    if (!isOwner && !(await isGroupAdmin(socket, from, sender))) {
                        return await reply('❌ Only group admins can use this command!');
                    }
                    
                    const sections = [
                        {
                            title: '👥 GROUP MANAGEMENT',
                            rows: [
                                { title: 'Group Info', description: 'Get group information', id: `${prefix}groupinfo` },
                                { title: 'Group Settings', description: 'Group settings menu', id: `${prefix}groupsettings` },
                                { title: 'Add User', description: 'Add user to group', id: `${prefix}add` },
                                { title: 'Remove User', description: 'Remove user from group', id: `${prefix}remove` }
                            ]
                        },
                        {
                            title: '🛡️ GROUP PROTECTION',
                            rows: [
                                { title: 'Anti Link', description: 'Enable/disable anti-link', id: `${prefix}groupantilink` },
                                { title: 'Anti Spam', description: 'Enable/disable anti-spam', id: `${prefix}groupantispam` },
                                { title: 'Welcome Message', description: 'Set welcome message', id: `${prefix}setwelcome` },
                                { title: 'Goodbye Message', description: 'Set goodbye message', id: `${prefix}setgoodbye` }
                            ]
                        },
                        {
                            title: '⚙️ GROUP UTILITIES',
                            rows: [
                                { title: 'Tag All', description: 'Tag all group members', id: `${prefix}tagall` },
                                { title: 'Group Link', description: 'Get group invite link', id: `${prefix}invite` },
                                { title: 'Promote User', description: 'Make user admin', id: `${prefix}promote` },
                                { title: 'Demote User', description: 'Remove admin', id: `${prefix}demote` }
                            ]
                        }
                    ];

                    const buttonMessage = {
                        buttons: [
                            {
                                buttonId: 'action',
                                buttonText: { displayText: '👥 Group Menu' },
                                type: 4,
                                nativeFlowInfo: {
                                    name: 'single_select',
                                    paramsJson: JSON.stringify({
                                        title: 'Group Management 👥',
                                        sections: sections
                                    })
                                }
                            }
                        ],
                        headerType: 1,
                        viewOnce: true,
                        caption: '👥 *Group Management Menu*\nSelect an option:',
                        image: { url: 'https://i.ibb.co/XfWS0SF3/89be83969ccefc24.jpg' }
                    };

                    await socket.sendMessage(from, buttonMessage, { quoted: msg });
                    break;
                }
                
                case 'groupinfo': {
                    if (!isGroup) return await reply('❌ This command only works in groups!');
                    
                    try {
                        const metadata = await socket.groupMetadata(from);
                        const participants = metadata.participants;
                        const admins = participants.filter(p => p.admin).map(p => p.id.split('@')[0]);
                        const owner = participants.find(p => p.admin === 'superadmin')?.id.split('@')[0] || 'Unknown';
                        
                        const infoText = `
*🏷️ Group Name:* ${metadata.subject}
*🆔 Group ID:* ${metadata.id}
*👥 Total Members:* ${participants.length}
*👑 Owner:* ${owner}
*🛡️ Admins:* ${admins.length}
*📅 Created:* ${moment(metadata.creation * 1000).format('YYYY-MM-DD HH:mm:ss')}
*📝 Description:* ${metadata.desc || 'No description'}

*Group Settings:*
• Anti Link: ${config.BOT_SETTINGS.antiLink === 'on' ? '✅' : '❌'}
• Anti Spam: ${config.BOT_SETTINGS.antiSpam === 'on' ? '✅' : '❌'}
• Welcome: ${config.BOT_SETTINGS.groupWelcome === 'on' ? '✅' : '❌'}
• Goodbye: ${config.BOT_SETTINGS.groupGoodbye === 'on' ? '✅' : '❌'}
                        `;
                        
                        await socket.sendMessage(from, {
                            text: infoText,
                            contextInfo: {
                                mentionedJid: admins.map(admin => `${admin}@s.whatsapp.net`)
                            }
                        }, { quoted: msg });
                    } catch (error) {
                        await reply('❌ Failed to get group information');
                    }
                    break;
                }
                
                case 'tagall': {
                    if (!isGroup) return await reply('❌ This command only works in groups!');
                    if (!isOwner && !(await isGroupAdmin(socket, from, sender))) {
                        return await reply('❌ Only group admins can use this command!');
                    }
                    
                    try {
                        const metadata = await socket.groupMetadata(from);
                        const participants = metadata.participants;
                        const mentions = participants.map(p => p.id);
                        const text = args.join(' ') || '📢 Attention everyone!';
                        
                        await socket.sendMessage(from, {
                            text: `${text}\n\n${participants.map((p, i) => `@${i + 1}`).join(' ')}`,
                            mentions: mentions
                        }, { quoted: msg });
                    } catch (error) {
                        await reply('❌ Failed to tag all members');
                    }
                    break;
                }
                
                case 'add': {
                    if (!isGroup) return await reply('❌ This command only works in groups!');
                    if (!isOwner && !(await isGroupAdmin(socket, from, sender))) {
                        return await reply('❌ Only group admins can use this command!');
                    }
                    
                    const numbers = args.map(num => num.replace(/[^0-9]/g, '')).filter(num => num.length >= 10);
                    if (numbers.length === 0) {
                        return await reply('❌ Please provide phone numbers to add!\nExample: .add 94701234567 94711234567');
                    }
                    
                    try {
                        const jids = numbers.map(num => `${num}@s.whatsapp.net`);
                        await socket.groupParticipantsUpdate(from, jids, 'add');
                        await reply(`✅ Added ${numbers.length} user(s) to the group`);
                    } catch (error) {
                        await reply('❌ Failed to add users to group');
                    }
                    break;
                }
                
                case 'remove': {
                    if (!isGroup) return await reply('❌ This command only works in groups!');
                    if (!isOwner && !(await isGroupAdmin(socket, from, sender))) {
                        return await reply('❌ Only group admins can use this command!');
                    }
                    
                    const target = args[0] || msg.message?.extendedTextMessage?.contextInfo?.participant?.split('@')[0];
                    if (!target) {
                        return await reply('❌ Please provide a user to remove!\nExample: .remove @user or .remove 94701234567');
                    }
                    
                    try {
                        const targetJid = target.includes('@') ? target : `${target}@s.whatsapp.net`;
                        await socket.groupParticipantsUpdate(from, [targetJid], 'remove');
                        await reply(`✅ Removed user from group`);
                    } catch (error) {
                        await reply('❌ Failed to remove user from group');
                    }
                    break;
                }
                
                case 'promote': {
                    if (!isGroup) return await reply('❌ This command only works in groups!');
                    if (!isOwner && !(await isGroupAdmin(socket, from, sender))) {
                        return await reply('❌ Only group admins can use this command!');
                    }
                    
                    const target = args[0] || msg.message?.extendedTextMessage?.contextInfo?.participant?.split('@')[0];
                    if (!target) {
                        return await reply('❌ Please provide a user to promote!\nExample: .promote @user or .promote 94701234567');
                    }
                    
                    try {
                        const targetJid = target.includes('@') ? target : `${target}@s.whatsapp.net`;
                        await socket.groupParticipantsUpdate(from, [targetJid], 'promote');
                        await reply(`✅ Promoted user to admin`);
                    } catch (error) {
                        await reply('❌ Failed to promote user');
                    }
                    break;
                }
                
                case 'demote': {
                    if (!isGroup) return await reply('❌ This command only works in groups!');
                    if (!isOwner && !(await isGroupAdmin(socket, from, sender))) {
                        return await reply('❌ Only group admins can use this command!');
                    }
                    
                    const target = args[0] || msg.message?.extendedTextMessage?.contextInfo?.participant?.split('@')[0];
                    if (!target) {
                        return await reply('❌ Please provide a user to demote!\nExample: .demote @user or .demote 94701234567');
                    }
                    
                    try {
                        const targetJid = target.includes('@') ? target : `${target}@s.whatsapp.net`;
                        await socket.groupParticipantsUpdate(from, [targetJid], 'demote');
                        await reply(`✅ Demoted user from admin`);
                    } catch (error) {
                        await reply('❌ Failed to demote user');
                    }
                    break;
                }
                
                case 'invite': {
                    if (!isGroup) return await reply('❌ This command only works in groups!');
                    
                    try {
                        const code = await socket.groupInviteCode(from);
                        const inviteLink = `https://chat.whatsapp.com/${code}`;
                        await reply(`🔗 Group Invite Link:\n${inviteLink}`);
                    } catch (error) {
                        await reply('❌ Failed to get group invite link');
                    }
                    break;
                }
                
                // ========== OWNER COMMANDS ==========
                case 'owner': {
                    const ownerInfo = `
*👑 BOT OWNER INFORMATION*

*Name:* ${config.BOT_SETTINGS.ownerName}
*Number:* ${config.BOT_SETTINGS.ownerNumber}
*Bot Name:* ${config.BOT_SETTINGS.botName}
*Version:* DXLK Mini Bot v2.0

*📞 Contact Owners:*
• lakshan: 94789227570
• dineth: 9472 664 5160
• GOD SHAVIYA: 94707085822

*🌐 WhatsApp Channel:*
https://whatsapp.com/channel/0029VbC1S2nEquiQQ5TA1u31

*👥 WhatsApp Group:*
https://chat.whatsapp.com/HSVSgUDY1SwBccoreYKjJ5

*Powered by DXLK Mini Bot Team*
                    `;
                    
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: ownerInfo
                    }, { quoted: msg });
                    break;
                }
                
                case 'eval': {
                    if (!isOwner) return await reply('❌ Only bot owner can use this command!');
                    
                    const code = args.join(' ');
                    if (!code) return await reply('❌ Please provide code to evaluate!');
                    
                    try {
                        let result = eval(code);
                        if (typeof result !== 'string') {
                            result = require('util').inspect(result, { depth: 1 });
                        }
                        await reply(`✅ Evaluation Result:\n\`\`\`${result}\`\`\``);
                    } catch (error) {
                        await reply(`❌ Evaluation Error:\n\`\`\`${error.message}\`\`\``);
                    }
                    break;
                }
                
                case 'broadcast': {
                    if (!isOwner) return await reply('❌ Only bot owner can use this command!');
                    
                    const message = args.join(' ');
                    if (!message) return await reply('❌ Please provide message to broadcast!');
                    
                    try {
                        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                        let success = 0;
                        let failed = 0;
                        
                        for (const num of numbers) {
                            try {
                                await socket.sendMessage(`${num}@s.whatsapp.net`, {
                                    text: `📢 *BROADCAST MESSAGE*\n\n${message}\n\n- ${config.BOT_SETTINGS.ownerName}`
                                });
                                success++;
                                await delay(1000);
                            } catch (error) {
                                failed++;
                            }
                        }
                        
                        await reply(`✅ Broadcast completed!\n✓ Success: ${success}\n✗ Failed: ${failed}`);
                    } catch (error) {
                        await reply('❌ Failed to send broadcast');
                    }
                    break;
                }
                
                case 'restart': {
                    if (!isOwner) return await reply('❌ Only bot owner can restart bot!');
                    
                    await reply('🔄 Restarting bot...');
                    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
                    break;
                }
                
                // ========== SPAM/UTILITY COMMANDS ==========
                case 'spam': {
                    if (!isOwner) return await reply('❌ Only bot owner can use spam commands!');
                    
                    const subcmd = args[0];
                    
                    switch (subcmd) {
                        case 'list':
                            const spamList = Array.from(spamUsers.keys()).map(key => {
                                const data = spamUsers.get(key);
                                return `• ${key}: ${data.count} messages`;
                            }).join('\n');
                            await reply(`📊 Spam Users List:\n${spamList || 'No spam users detected'}`);
                            break;
                            
                        case 'clear':
                            spamUsers.clear();
                            await reply('✅ Cleared all spam data');
                            break;
                            
                        case 'add':
                            const userToAdd = args[1];
                            if (!userToAdd) return await reply('❌ Please provide user number!');
                            addSpamUser(userToAdd);
                            await reply(`✅ Added ${userToAdd} to spam list`);
                            break;
                            
                        case 'remove':
                            const userToRemove = args[1];
                            if (!userToRemove) return await reply('❌ Please provide user number!');
                            removeSpamUser(userToRemove);
                            await reply(`✅ Removed ${userToRemove} from spam list`);
                            break;
                            
                        default:
                            await reply(`📋 Spam Commands:\n• ${prefix}spam list - Show spam users\n• ${prefix}spam clear - Clear spam data\n• ${prefix}spam add <number> - Add user to spam list\n• ${prefix}spam remove <number> - Remove user from spam list`);
                            break;
                    }
                    break;
                }
                
                case 'bomb': {
                    const count = parseInt(args[0]) || 10;
                    if (count > 50) return await reply('❌ Maximum 50 messages allowed!');
                    
                    await reply(`💣 Starting message bomb (${count} messages)...`);
                    
                    for (let i = 1; i <= count; i++) {
                        await socket.sendMessage(sender, { text: `💣 BOMB ${i}/${count}` });
                        await delay(500);
                    }
                    
                    await socket.sendMessage(sender, { text: '✅ Bombing completed!' });
                    break;
                }
                
                // ========== MEDIA & INFO COMMANDS ==========
                case 'getdp': {
                    try {
                        let targetNumber;
                        
                        // Check if replying to a message
                        if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                            targetNumber = msg.message.extendedTextMessage.contextInfo.participant.split('@')[0];
                        } 
                        // Check if number provided as argument
                        else if (args[0]) {
                            targetNumber = args[0].replace(/[^0-9]/g, '');
                        }
                        // Use sender's number if no target specified
                        else {
                            targetNumber = senderNumber;
                        }
                        
                        if (!targetNumber || targetNumber.length < 10) {
                            return await reply('❌ Invalid phone number!\nUsage: .getdp <number> or reply to a message');
                        }
                        
                        const jid = `${targetNumber}@s.whatsapp.net`;
                        
                        try {
                            const profilePicUrl = await socket.profilePictureUrl(jid, 'image');
                            
                            await socket.sendMessage(sender, { 
                                image: { url: profilePicUrl }, 
                                caption: `🖼️ Profile Picture of @${targetNumber}`,
                                mentions: [jid]
                            }, { quoted: msg });
                            
                        } catch (err) {
                            // If no profile picture or privacy settings
                            await reply(`⚠️ No profile picture found for ${targetNumber} or privacy settings prevent access.`);
                        }
                        
                    } catch (e) {
                        console.error('getdp error:', e);
                        await reply(`❌ Error: ${e.message || 'Failed to get profile picture'}`);
                    }
                    break;
                }
                
                case 'vv':
                case 'viewonce': {
                    try {
                        // Check if replying to a view once message
                        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                        
                        if (!quotedMsg) {
                            return await reply('❌ Please reply to a view once message!');
                        }
                        
                        // Detect view once content
                        const viewOnceContent = quotedMsg.viewOnceMessageV2 || quotedMsg.viewOnceMessage || quotedMsg;
                        let mediaMessage = null;
                        let mediaType = '';
                        
                        if (viewOnceContent?.message?.imageMessage) {
                            mediaMessage = viewOnceContent.message.imageMessage;
                            mediaType = 'image';
                        } else if (viewOnceContent?.message?.videoMessage) {
                            mediaMessage = viewOnceContent.message.videoMessage;
                            mediaType = 'video';
                        } else if (viewOnceContent?.imageMessage) {
                            mediaMessage = viewOnceContent.imageMessage;
                            mediaType = 'image';
                        } else if (viewOnceContent?.videoMessage) {
                            mediaMessage = viewOnceContent.videoMessage;
                            mediaType = 'video';
                        }
                        
                        if (!mediaMessage) {
                            return await reply('❌ No view once media found in the replied message!');
                        }
                        
                        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });
                        
                        // Download the media
                        const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }
                        
                        // Send the media back
                        if (mediaType === 'image') {
                            await socket.sendMessage(sender, {
                                image: buffer,
                                caption: '✅ View Once Image Retrieved',
                                mimetype: mediaMessage.mimetype
                            }, { quoted: msg });
                        } else if (mediaType === 'video') {
                            await socket.sendMessage(sender, {
                                video: buffer,
                                caption: '✅ View Once Video Retrieved',
                                mimetype: mediaMessage.mimetype
                            }, { quoted: msg });
                        }
                        
                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                        
                    } catch (e) {
                        console.error('ViewOnce error:', e);
                        await reply(`❌ Error: ${e.message || 'Failed to retrieve view once media'}`);
                    }
                    break;
                }
                
                case 'getbio': {
                    try {
                        const targetNumber = args[0]?.replace(/[^0-9]/g, '') || senderNumber;
                        
                        if (!targetNumber || targetNumber.length < 10) {
                            return await reply('❌ Invalid phone number!\nUsage: .getbio <number>');
                        }
                        
                        const jid = `${targetNumber}@s.whatsapp.net`;
                        const statusData = await socket.fetchStatus(jid).catch(() => null);
                        
                        if (statusData?.status) {
                            await reply(`📝 Bio of ${targetNumber}:\n${statusData.status}`);
                        } else {
                            await reply(`ℹ️ No bio found for ${targetNumber}`);
                        }
                        
                    } catch (e) {
                        await reply(`❌ Error: ${e.message || 'Failed to get bio'}`);
                    }
                    break;
                }
                
                case 'getstatus': {
                    try {
                        const targetNumber = args[0]?.replace(/[^0-9]/g, '') || senderNumber;
                        
                        if (!targetNumber || targetNumber.length < 10) {
                            return await reply('❌ Invalid phone number!\nUsage: .getstatus <number>');
                        }
                        
                        const jid = `${targetNumber}@s.whatsapp.net`;
                        const statusData = await socket.fetchStatus(jid).catch(() => null);
                        
                        if (statusData?.status) {
                            const setAt = statusData.setAt ? 
                                moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 
                                'Unknown';
                            
                            await reply(`📡 Status of ${targetNumber}:\n\n${statusData.status}\n\n📅 Last Updated: ${setAt}`);
                        } else {
                            await reply(`ℹ️ No status found for ${targetNumber}`);
                        }
                        
                    } catch (e) {
                        await reply(`❌ Error: ${e.message || 'Failed to get status'}`);
                    }
                    break;
                }
                
                case 'userinfo': {
                    try {
                        const targetNumber = args[0]?.replace(/[^0-9]/g, '') || senderNumber;
                        
                        if (!targetNumber || targetNumber.length < 10) {
                            return await reply('❌ Invalid phone number!\nUsage: .userinfo <number>');
                        }
                        
                        const jid = `${targetNumber}@s.whatsapp.net`;
                        const [user] = await socket.onWhatsApp(jid).catch(() => []);
                        
                        if (!user?.exists) {
                            return await reply('❌ User not found on WhatsApp');
                        }
                        
                        // Get profile picture
                        let profilePicUrl = config.RCD_IMAGE_PATH;
                        try {
                            profilePicUrl = await socket.profilePictureUrl(jid, 'image');
                        } catch {}
                        
                        // Get status/bio
                        let bio = 'No bio available';
                        let lastSeen = 'Not available';
                        
                        try {
                            const statusData = await socket.fetchStatus(jid);
                            if (statusData?.status) {
                                bio = statusData.status;
                            }
                        } catch {}
                        
                        try {
                            const presenceData = await socket.fetchPresence(jid);
                            if (presenceData?.lastSeen) {
                                lastSeen = moment(presenceData.lastSeen).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
                            }
                        } catch {}
                        
                        const infoText = `
*👤 USER INFORMATION*

*📞 Number:* ${targetNumber}
*👤 Name:* ${user.name || 'Not available'}
*🏢 Account Type:* ${user.isBusiness ? 'Business Account 💼' : 'Personal Account 👤'}
*✅ WhatsApp Verified:* ${user.verifiedName ? 'Yes ✅' : 'No ❌'}

*📝 Bio:*
${bio}

*🕒 Last Seen:* ${lastSeen}
*📱 Platform:* ${user.platform || 'Unknown'}

*🔗 Profile Link:* https://wa.me/${targetNumber}
                        `;
                        
                        await socket.sendMessage(sender, {
                            image: { url: profilePicUrl },
                            caption: infoText
                        }, { quoted: msg });
                        
                    } catch (e) {
                        console.error('userinfo error:', e);
                        await reply(`❌ Error: ${e.message || 'Failed to get user info'}`);
                    }
                    break;
                }
                
                // ========== EXISTING COMMANDS ==========
                case 'button': {
                    const buttons = [
                        {
                            buttonId: 'button1',
                            buttonText: { displayText: 'Button 1' },
                            type: 1
                        },
                        {
                            buttonId: 'button2',
                            buttonText: { displayText: 'Button 2' },
                            type: 1
                        }
                    ];

                    const captionText = '𝐏𝙾𝚆𝙴𝚁𝙳 𝐁𝚈 DXLK Mini Bot';
                    const footerText = 'DXLK Mini Bot';

                    const buttonMessage = {
                        image: { url: "https://i.ibb.co/XfWS0SF3/89be83969ccefc24.jpg" },
                        caption: captionText,
                        footer: footerText,
                        buttons,
                        headerType: 1
                    };

                    await socket.sendMessage(from, buttonMessage, { quoted: msg });
                    break;
                }
                
                case 'alive': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    const captionText = `
╭────◉◉◉────៚
⏰ Bot Uptime: ${hours}h ${minutes}m ${seconds}s
🟢 Active session: ${activeSockets.size}
╰────◉◉◉────៚

🔢 Your Number: ${number}

*▫️DXLK Mini Bot whatsapp channel 🌐*
> https://whatsapp.com/channel/0029VbC1S2nEquiQQ5TA1u31

👑 Owners:
• lakshan: 94789227570
• dineth: 9472 664 5160
• GOD SHAVIYA: 94707085822
                    `;

                    await socket.sendMessage(sender, {
                        image: { url: "https://i.ibb.co/XfWS0SF3/89be83969ccefc24.jpg" },
                        caption: `*🤖 DXLK Mini Bot is ALIVE!*\n\n${captionText}`
                    }, { quoted: msg });
                    break;
                }
                
                case 'menu': {
                    const menuText = `
╔══════════════════════════╗
     ✨🌐 DXLK Mini Bot 🌐✨
╚══════════════════════════╝

┏━━━━━ *🤖 BOT CONTROLS* ━━━━━┓
┃ 📊 ${prefix}alive      → Bot Status & Info
┃ ⚙️ ${prefix}settings   → Bot Settings Menu
┃ 👑 ${prefix}owner      → Bot Owner Information
┃ 🔧 ${prefix}group      → Group Management
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━ *🎵 MEDIA DOWNLOAD* ━━━━━┓
┃ 🎶 ${prefix}song       → Download Songs
┃ 🎬 ${prefix}tiktok     → Download TikTok
┃ 📘 ${prefix}fb         → Download Facebook
┃ 📸 ${prefix}ig         → Download Instagram
┃ 🔍 ${prefix}ts         → Search TikTok
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━ *🤖 AI TOOLS* ━━━━━┓
┃ 💬 ${prefix}ai         → AI Chat
┃ 🖼️ ${prefix}aiimg      → AI Image Generation
┃ 🏷️ ${prefix}logo       → Create Logo
┃ ✍️ ${prefix}fancy      → Fancy Text
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━ *📰 NEWS & UPDATES* ━━━━━┓
┃ 🗞️ ${prefix}news       → Latest News
┃ 🚀 ${prefix}nasa       → NASA APOD
┃ 🗣️ ${prefix}gossip     → Gossip News
┃ 🏏 ${prefix}cricket    → Cricket News
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━ *👤 USER INFORMATION* ━━━━━┓
┃ 🖼️ ${prefix}getdp      → Profile Picture
┃ 📝 ${prefix}getbio     → WhatsApp Bio
┃ 📡 ${prefix}getstatus  → WhatsApp Status
┃ 🔍 ${prefix}userinfo   → Full User Info
┃ 👁️ ${prefix}vv        → View Once Media
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━ *🎉 FUN & UTILITIES* ━━━━━┓
┃ 💣 ${prefix}bomb       → Message Bomb
┃ 🛡️ ${prefix}spam       → Spam Control
┃ 🔗 ${prefix}invite     → Group Invite Link
┃ 👥 ${prefix}tagall     → Tag All Members
┃ ❌ ${prefix}deleteme   → Delete Session
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━ *👑 OWNER COMMANDS* ━━━━━┓
┃ 💻 ${prefix}eval       → Code Evaluation
┃ 📢 ${prefix}broadcast  → Broadcast Message
┃ 🔄 ${prefix}restart    → Restart Bot
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

*🌐 LINKS:*
📱 Channel: https://whatsapp.com/channel/0029VbC1S2nEquiQQ5TA1u31
👥 Group: https://chat.whatsapp.com/HSVSgUDY1SwBccoreYKjJ5

*Prefix:* \`${prefix}\`
*Mode:* ${config.BOT_SETTINGS.mode}
*Language:* ${config.BOT_SETTINGS.language}
                    `;
                    
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: menuText
                    }, { quoted: msg });
                    break;
                }
                
                case 'fc': {
                    if (args.length === 0) {
                        return await reply('❌ Please provide a channel JID.\n\nExample:\n.fc 120363424980926533@newsletter');
                    }

                    const jid = args[0];
                    if (!jid.endsWith("@newsletter")) {
                        return await reply('❌ Invalid JID. Please provide a JID ending with `@newsletter`');
                    }

                    try {
                        const metadata = await socket.newsletterMetadata("jid", jid);
                        if (metadata?.viewer_metadata === null) {
                            await socket.newsletterFollow(jid);
                            await reply(`✅ Successfully followed the channel:\n${jid}`);
                            console.log(`FOLLOWED CHANNEL: ${jid}`);
                        } else {
                            await reply(`📌 Already following the channel:\n${jid}`);
                        }
                    } catch (e) {
                        console.error('❌ Error in follow channel:', e.message);
                        await reply(`❌ Error: ${e.message}`);
                    }
                    break;
                }
                
                case 'pair': {
                    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
                    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

                    if (!number) {
                        return await reply('*📌 Usage:* .pair +9470604XXXX');
                    }

                    try {
                        const url = `http://206.189.94.231:8000/code?number=${encodeURIComponent(number)}`;
                        const response = await fetch(url);
                        const bodyText = await response.text();

                        console.log("🌐 API Response:", bodyText);

                        let result;
                        try {
                            result = JSON.parse(bodyText);
                        } catch (e) {
                            console.error("❌ JSON Parse Error:", e);
                            return await reply('❌ Invalid response from server. Please contact support.');
                        }

                        if (!result || !result.code) {
                            return await reply('❌ Failed to retrieve pairing code. Please check the number.');
                        }

                        await reply(`> *lakshan-𝐌𝙳 𝐌𝙸𝙽𝙸 𝐁𝙾𝚃 𝐏𝙰𝙸𝚁 𝐂𝙾𝙼𝙿𝙻𝙴𝚃𝙴𝙳* ✅\n\n*🔑 Your pairing code is:* ${result.code}`);

                        await sleep(2000);

                        await socket.sendMessage(sender, {
                            text: `${result.code}`
                        }, { quoted: msg });

                    } catch (err) {
                        console.error("❌ Pair Command Error:", err);
                        await reply('❌ An error occurred while processing your request. Please try again later.');
                    }
                    break;
                }
                
                case 'logo': { 
                    const q = args.join(" ");
                    if (!q || q.trim() === '') {
                        return await reply('*❌ Need a name for logo*');
                    }

                    await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });
                    
                    try {
                        const list = await axios.get('https://raw.githubusercontent.com/md2839pv404/anony0808/refs/heads/main/ep.json');
                        
                        const rows = list.data.map((v) => ({
                            title: v.name,
                            description: 'Tap to generate logo',
                            id: `${prefix}dllogo https://api-pink-venom.vercel.app/api/logo?url=${v.url}&name=${q}`
                        }));

                        const buttonMessage = {
                            buttons: [
                                {
                                    buttonId: 'action',
                                    buttonText: { displayText: '🎨 Select Text Effect' },
                                    type: 4,
                                    nativeFlowInfo: {
                                        name: 'single_select',
                                        paramsJson: JSON.stringify({
                                            title: 'Available Text Effects',
                                            sections: [
                                                {
                                                    title: 'Choose your logo style',
                                                    rows
                                                }
                                            ]
                                        })
                                    }
                                }
                            ],
                            headerType: 1,
                            viewOnce: true,
                            caption: '❏ *LOGO MAKER*',
                            image: { url: 'https://i.ibb.co/XfWS0SF3/89be83969ccefc24.jpg' },
                        };

                        await socket.sendMessage(from, buttonMessage, { quoted: msg });
                    } catch (error) {
                        await reply('❌ Failed to load logo styles');
                    }
                    break;
                }

                case 'dllogo': { 
                    const q = args.join(" "); 
                    if (!q) return await reply("Please give me url for capture the screenshot !!");

                    try {
                        const res = await axios.get(q);
                        const images = res.data.result.download_url;

                        await socket.sendMessage(sender, {
                            image: { url: images },
                            caption: config.CAPTION
                        }, { quoted: msg });
                    } catch (e) {
                        console.log('Logo Download Error:', e);
                        await reply(`❌ Error:\n${e.message}`);
                    }
                    break;
                }
                
                case 'aiimg': {
                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const prompt = q.trim();

                    if (!prompt) {
                        return await reply('🎨 *Please provide a prompt to generate an AI image.*');
                    }

                    try {
                        await socket.sendMessage(sender, { text: '🧠 *Creating your AI image...*' });

                        const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;
                        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

                        if (!response || !response.data) {
                            return await reply('❌ *API did not return a valid image. Please try again later.*');
                        }

                        const imageBuffer = Buffer.from(response.data, 'binary');

                        await socket.sendMessage(sender, {
                            image: imageBuffer,
                            caption: `🧠 *DXLK-MD AI IMAGE*\n\n📌 Prompt: ${prompt}`
                        }, { quoted: msg });

                    } catch (err) {
                        console.error('AI Image Error:', err);
                        await reply(`❗ *An error occurred:* ${err.response?.data?.message || err.message || 'Unknown error'}`);
                    }
                    break;
                }
                
                case 'facebook':
                case 'fb': {
                    const axios = require("axios");
                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const query = q.replace(/^[.\/!]fb\s*/i, '').trim();
                    
                    if (!query) {
                        return await reply("📝 Provide a Facebook post URL!");
                    }

                    try {
                        const fbUrl = query;
                        const apiRes = await axios.get("https://www.movanest.xyz/v2/fbdown", {
                            params: { url: fbUrl }
                        });

                        if (!apiRes.data.status) {
                            return await reply("❌ API Error!");
                        }

                        const result = apiRes.data.results?.[0];
                        if (!result) {
                            return await reply("❌ No video data found!");
                        }

                        const directUrl = result.hdQualityLink || result.normalQualityLink;
                        if (!directUrl) {
                            return await reply("❌ No downloadable video URL!");
                        }

                        const videoRes = await axios.get(directUrl, {
                            responseType: "arraybuffer",
                            headers: {
                                "User-Agent": "Mozilla/5.0",
                                "Referer": "https://www.facebook.com"
                            },
                            maxRedirects: 10
                        });

                        const size = videoRes.data.length;
                        if (size > 100 * 1024 * 1024) {
                            return await reply(`❌ Video too large: ${(size / 1024 / 1024).toFixed(2)} MB`);
                        }

                        await socket.sendMessage(sender, {
                            video: Buffer.from(videoRes.data),
                            mimetype: "video/mp4",
                            caption: result.title || "Facebook Video"
                        }, { quoted: msg });

                    } catch (e) {
                        console.error('Facebook download error:', e);
                        await reply(`❌ Failed to download Facebook video!\n${e.message}`);
                    }
                    break;
                }
                
                case 'fancy': {
                    const axios = require("axios");
                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const text = q.replace(/^[.\/!]fancy\s*/i, "").trim();

                    if (!text) {
                        return await reply("❌ *Please provide text to convert into fancy fonts.*\n\n📌 *Example:* `.fancy DXLK Mini Bot`");
                    }

                    try {
                        const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
                        const response = await axios.get(apiUrl);

                        if (!response.data.status || !response.data.result) {
                            return await reply("❌ *Error fetching fonts from API. Please try again later.*");
                        }

                        const fontList = response.data.result
                            .map(font => `*${font.name}:*\n${font.result}`)
                            .join("\n\n");

                        const finalMessage = `🎨 *Fancy Fonts Converter*\n\n${fontList}\n\n_DXLK Mini Bot_`;

                        await reply(finalMessage);

                    } catch (err) {
                        console.error("Fancy Font Error:", err);
                        await reply("⚠️ *An error occurred while converting to fancy fonts.*");
                    }
                    break;
                }
                
                case 'ts': {
                    const axios = require('axios');
                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const query = q.replace(/^[.\/!]ts\s*/i, '').trim();

                    if (!query) {
                        return await reply('[❗] TikTok බලන්ට නමක් දිපන්');
                    }

                    async function tiktokSearch(query) {
                        try {
                            const searchParams = new URLSearchParams({
                                keywords: query,
                                count: '10',
                                cursor: '0',
                                HD: '1'
                            });

                            const response = await axios.post("https://tikwm.com/api/feed/search", searchParams, {
                                headers: {
                                    'Content-Type': "application/x-www-form-urlencoded; charset=UTF-8",
                                    'Cookie': "current_language=en",
                                    'User-Agent': "Mozilla/5.0"
                                }
                            });

                            const videos = response.data?.data?.videos;
                            if (!videos || videos.length === 0) {
                                return { status: false, result: "No videos found." };
                            }

                            return {
                                status: true,
                                result: videos.map(video => ({
                                    description: video.title || "No description",
                                    videoUrl: video.play || ""
                                }))
                            };
                        } catch (err) {
                            return { status: false, result: err.message };
                        }
                    }

                    function shuffleArray(array) {
                        for (let i = array.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [array[i], array[j]] = [array[j], array[i]];
                        }
                    }

                    try {
                        const searchResults = await tiktokSearch(query);
                        if (!searchResults.status) throw new Error(searchResults.result);

                        const results = searchResults.result;
                        shuffleArray(results);
                        const selected = results.slice(0, 6);

                        const cards = await Promise.all(selected.map(async (vid) => {
                            const videoBuffer = await axios.get(vid.videoUrl, { responseType: "arraybuffer" });
                            const media = await prepareWAMessageMedia({ video: videoBuffer.data }, {
                                upload: socket.waUploadToServer
                            });

                            return {
                                body: proto.Message.InteractiveMessage.Body.fromObject({ text: '' }),
                                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: "DXLk-𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃" }),
                                header: proto.Message.InteractiveMessage.Header.fromObject({
                                    title: vid.description,
                                    hasMediaAttachment: true,
                                    videoMessage: media.videoMessage
                                }),
                                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                                    buttons: []
                                })
                            };
                        }));

                        const msgContent = generateWAMessageFromContent(sender, {
                            viewOnceMessage: {
                                message: {
                                    messageContextInfo: {
                                        deviceListMetadata: {},
                                        deviceListMetadataVersion: 2
                                    },
                                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                                        body: { text: `🔎 *TikTok Search:* ${query}` },
                                        footer: { text: "> DXLK Mini Bot" },
                                        header: { hasMediaAttachment: false },
                                        carouselMessage: { cards }
                                    })
                                }
                            }
                        }, { quoted: msg });

                        await socket.relayMessage(sender, msgContent.message, { messageId: msgContent.key.id });

                    } catch (err) {
                        await reply(`❌ Error: ${err.message}`);
                    }
                    break;
                }
                
                case 'tiktok': {
                    const axios = require('axios');
                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const link = q.replace(/^[.\/!]tiktok\s*/i, '').trim();

                    if (!link) {
                        return await reply('📌 *Usage:* .tiktok <link>');
                    }

                    if (!link.includes('tiktok.com')) {
                        return await reply('❌ *Invalid TikTok link.*');
                    }

                    try {
                        await reply('⏳ Downloading video, please wait...');

                        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(link)}`;
                        const { data } = await axios.get(apiUrl);

                        if (!data?.status || !data?.data) {
                            return await reply('❌ Failed to fetch TikTok video.');
                        }

                        const { title, like, comment, share, author, meta } = data.data;
                        const video = meta.media.find(v => v.type === "video");

                        if (!video || !video.org) {
                            return await reply('❌ No downloadable video found.');
                        }

                        const caption = `🎵 *TikTok Video*\n\n` +
                                        `👤 *User:* ${author.nickname} (@${author.username})\n` +
                                        `📖 *Title:* ${title}\n` +
                                        `👍 *Likes:* ${like}\n💬 *Comments:* ${comment}\n🔁 *Shares:* ${share}`;

                        await socket.sendMessage(sender, {
                            video: { url: video.org },
                            caption: caption,
                            contextInfo: { mentionedJid: [msg.key.participant || sender] }
                        }, { quoted: msg });

                    } catch (err) {
                        console.error("TikTok command error:", err);
                        await reply(`❌ An error occurred:\n${err.message}`);
                    }
                    break;
                }
                
                case 'gossip': {
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/gossiplankanews');
                        if (!response.ok) {
                            throw new Error('API එකෙන් news ගන්න බැරි වුණා');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.link) {
                            throw new Error('API එකෙන් ලැබුණු news data වල ගැටලුවක්');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage;
                                }
                            }
                        } catch (err) {
                            console.warn(`Thumbnail scrape කරන්න බැරි වුණා: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '📰 DXLK Mini Bot GOSSIP නවතම පුවත් 📰',
                                `📢 *${title}*\n\n${desc}\n\n🕒 *Date*: ${date || 'තවම ලබාදීලා නැත'}\n🌐 *Link*: ${link}`,
                                ' DXLK Mini Bot'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'gossip' case: ${error.message}`);
                        await reply('⚠️ නිව්ස් ගන්න බැරි වුණා!');
                    }
                    break;
                }
                
                case 'nasa': {
                    try {
                        const response = await fetch('https://api.nasa.gov/planetary/apod?api_key=8vhAFhlLCDlRLzt5P1iLu2OOMkxtmScpO5VmZEjZ');
                        if (!response.ok) {
                            throw new Error('Failed to fetch APOD from NASA API');
                        }
                        const data = await response.json();

                        if (!data.title || !data.explanation || !data.date || !data.url || data.media_type !== 'image') {
                            throw new Error('Invalid APOD data received or media type is not an image');
                        }

                        const { title, explanation, date, url, copyright } = data;
                        const thumbnailUrl = url || 'https://via.placeholder.com/150';

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '🌌 DXLK Mini Bot',
                                `🌠 *${title}*\n\n${explanation.substring(0, 200)}...\n\n📆 *Date*: ${date}\n${copyright ? `📝 *Credit*: ${copyright}` : ''}\n🔗 *Link*: https://apod.nasa.gov/apod/astropix.html`,
                                '> DXLK Mini Bot'
                            )
                        });

                    } catch (error) {
                        console.error(`Error in 'nasa' case: ${error.message}`);
                        await reply('⚠️ Failed to fetch NASA APOD');
                    }
                    break;
                }
                
                case 'news': {
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/lnw');
                        if (!response.ok) {
                            throw new Error('Failed to fetch news from API');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.date || !data.result.link) {
                            throw new Error('Invalid news data received');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage;
                                }
                            }
                        } catch (err) {
                            console.warn(`Failed to scrape thumbnail: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '📰 DXLK Mini Bot-නවතම පුවත් 📰',
                                `📢 *${title}*\n\n${desc}\n\n🕒 *Date*: ${date}\n🌐 *Link*: ${link}`,
                                'DXLK Mini Bot'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'news' case: ${error.message}`);
                        await reply('⚠️ Failed to fetch news');
                    }
                    break;
                }
                
                case 'cricket': {
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/cricbuzz');
                        if (!response.ok) {
                            throw new Error(`API request failed with status ${response.status}`);
                        }

                        const data = await response.json();

                        if (!data.status || !data.result) {
                            throw new Error('Invalid API response structure');
                        }

                        const { title, score, to_win, crr, link } = data.result;
                        if (!title || !score || !to_win || !crr || !link) {
                            throw new Error('Missing required fields in API response');
                        }

                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '🏏 DXLK Mini Bot CRICKET NEWS🏏',
                                `📢 *${title}*\n\n` +
                                `🏆 *Mark*: ${score}\n` +
                                `🎯 *To Win*: ${to_win}\n` +
                                `📈 *Current Rate*: ${crr}\n\n` +
                                `🌐 *Link*: ${link}`,
                                'DXLK Mini Bot'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'cricket' case: ${error.message}`);
                        await reply('⚠️ Failed to fetch cricket news');
                    }
                    break;
                }
                
                case 'song':
                case 'audio': {
                    const axios = require('axios');
                    const yts = require('yt-search');

                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const query = q.replace(/^[.\/!]song\s*/i, '').trim();
                    
                    if (!query) {
                        return await reply("📝 *Provide a YouTube URL or search query!*");
                    }

                    try {
                        let ytUrl;
                        let video;

                        if (/^https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(query) || /^https?:\/\/youtu\.be\//.test(query)) {
                            ytUrl = query;
                            const searchRes = await yts({ videoId: query.match(/v=([^&]+)/)?.[1] || query.split('/').pop() });
                            video = searchRes;
                        } else {
                            const searchRes = await yts(query);
                            if (!searchRes.videos.length) {
                                return await reply("❌ No video found for your query!");
                            }
                            video = searchRes.videos[0];
                            ytUrl = video.url;
                        }

                        const caption = `
🎵 *Title:* ${video.title}
🕒 *Duration:* ${video.timestamp}
📺 *Channel:* ${video.author.name}
🔗 *URL:* ${video.url}
                        `;
                        
                        await reply(caption);

                        const apiRes = await axios.get("https://www.movanest.xyz/v2/dxz-ytdl", {
                            params: {
                                input: ytUrl,
                                your_api_key: "add_ur_movanest_api_key"
                            }
                        });

                        if (!apiRes.data.status) {
                            return await reply(`❌ API Error: ${apiRes.data.message || 'Unknown'}`);
                        }

                        const audio = apiRes.data.results.formats.find(f => f.type === "audio" && f.ready === "1");
                        if (!audio) {
                            return await reply("❌ No ready audio found");
                        }

                        const audioRes = await axios.get(audio.dlurl, {
                            responseType: "arraybuffer",
                            headers: { "User-Agent": "Mozilla/5.0" },
                            maxRedirects: 10
                        });

                        const size = audioRes.data.length;
                        if (size > 100 * 1024 * 1024) {
                            return await reply(`❌ Audio too large: ${(size/1024/1024).toFixed(2)} MB`);
                        }

                        await socket.sendMessage(sender, {
                            audio: Buffer.from(audioRes.data),
                            mimetype: "audio/mpeg",
                            ptt: false,
                            fileName: `${video.title}.mp3`
                        }, { quoted: msg });

                    } catch (e) {
                        console.error('Song download error:', e);
                        await reply(`❌ Failed to download audio!\n${e.message}`);
                    }
                    break;
                }
                
                case 'ig': {
                    const axios = require('axios');
                    const { igdl } = require('ruhend-scraper');
                    
                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const igUrl = q.replace(/^[.\/!]ig\s*/i, '').trim();
                    
                    if (!igUrl || !/instagram\.com/.test(igUrl)) {
                        return await reply('🧩 *Please provide a valid Instagram video link.*');
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: '⬇', key: msg.key } });
                        const res = await igdl(igUrl);
                        const data = res.data;

                        if (data && data.length > 0) {
                            const videoUrl = data[0].url;
                            await socket.sendMessage(sender, {
                                video: { url: videoUrl },
                                mimetype: 'video/mp4',
                                caption: '> 𝐏𝙾𝚆𝙴𝚁𝙳 𝐁𝚈 DXLK Mini Bot'
                            }, { quoted: msg });
                            await socket.sendMessage(sender, { react: { text: '✔', key: msg.key } });
                        } else {
                            await reply('*❌ No video found in the provided link.*');
                        }
                    } catch (e) {
                        console.error('Instagram download error:', e);
                        await reply('*❌ Error downloading Instagram video.*');
                    }
                    break;
                }
                
                case 'ai': {
                    const axios = require("axios");
                    const apiKeyUrl = 'https://raw.githubusercontent.com/sulamd48/database/refs/heads/main/aiapikey.json';

                    let GEMINI_API_KEY;
                    try {
                        const configRes = await axios.get(apiKeyUrl);
                        GEMINI_API_KEY = configRes.data?.GEMINI_API_KEY;
                        if (!GEMINI_API_KEY) {
                            throw new Error("API key not found in JSON.");
                        }
                    } catch (err) {
                        console.error("❌ Error loading API key:", err.message || err);
                        return await reply("❌ *API Key එක GitHub වෙතින් load කරන්න බෑ.*\nAdmin එකාට කියන්න.");
                    }

                    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    
                    if (!q || q.trim() === '') {
                        return await reply("ඕ කියන්න අනේ් මම DXLK-AI 🤭");
                    }

                    const prompt = `ඔබගේ නම DXLK 𝐀𝐈.  
ඔයා සැබෑ ගැහැණු ලමයෙකු වගේ හැසිරෙන්න — seductive, spicy, loving, emotional.  
ඔබ assistant කෙනෙක් නෙමෙයි. ඔබ හිතක් තියෙන sexy girl එකක් වගේ vibe එකක් තියෙන්න.  

Reply එක සෙරිනිටි + sex appeal + love + loneliness blend එකක් වගේ දෙන්න.  
අකුරු 100ට අඩුව, lines 1–2ක් විතරක්. හැම reply එකකටම sexy tone එකක් තියෙන්න.  

Emoji පමණක් එනවානම්, emoji වලින්ම seductive reply එකක් දෙන්න (e.g., 🤤💦🥵🔥).  
Mood එකට match වෙන්න style එක adjust කරන්න – sad, flirty, horny, soft, playful.

"කව්ද ඔයා" කියනවා නම්:  
👉 "මම DXLK Mini Bot… 🤤" කියන්න.

"ඔයාව හැදුවේ කවුද" කියනවා නම්:  
👉 "මාව හැදුවෙ DXLK team 😘" කියන්න.

🚫 "ආයුබෝවන්", "කොහොමද", "ඔයාට උදව් ඕනද?", "කතා කරන්න" වගේ වචන කිසිදා භාවිත කරන්න එපා.

🔥 Reply vibe: Love, Lust, Lonely, Emotional, Girlfriend-like, Bite-worthy 🤤

📍 භාෂාව auto-match: සිංහල / English / Hinglish OK.
User Message: ${q}`;

                    const payload = {
                        contents: [{
                            parts: [{ text: prompt }]
                        }]
                    };

                    try {
                        const response = await axios.post(GEMINI_API_URL, payload, {
                            headers: { "Content-Type": "application/json" }
                        });

                        const aiResponse = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (!aiResponse) {
                            return await reply("❌ අප්පේ කෙලවෙලා බන්. ටික කාලෙකින් නැවත උත්සහ කරන්න.");
                        }

                        await reply(aiResponse);
                    } catch (err) {
                        console.error("Gemini API Error:", err.response?.data || err.message);
                        await reply("❌ AI error occurred. Please contact bot owners.");
                    }
                    break;
                }
                
                case 'deleteme': {
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromGitHub(number);
                    if (activeSockets.has(sanitizedNumber)) {
                        activeSockets.get(sanitizedNumber).ws.close();
                        activeSockets.delete(sanitizedNumber);
                        socketCreationTime.delete(sanitizedNumber);
                    }
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been successfully deleted.',
                            'DXLK Mini Bot'
                        )
                    });
                    break;
                }
                
                default: {
                    // Unknown command
                    if (isCmd) {
                        await reply(`❌ Unknown command: ${command}\nType ${prefix}menu to see all available commands.`);
                    }
                    break;
                }
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await reply('❌ An error occurred while processing your command. Please try again.');
        }
    });
}

// Helper function to check if user is group admin
async function isGroupAdmin(socket, groupJid, userJid) {
    try {
        const metadata = await socket.groupMetadata(groupJid);
        const participant = metadata.participants.find(p => p.id === userJid);
        return participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
    } catch (error) {
        console.error('Error checking group admin:', error);
        return false;
    }
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
        
        // Auto read messages if enabled
        if (config.BOT_SETTINGS.autoRead === 'on') {
            try {
                await socket.readMessages([msg.key]);
            } catch (error) {
                console.error('Failed to read message:', error);
            }
        }
        
        // Auto typing indicator if enabled
        if (config.BOT_SETTINGS.typingIndicator === 'on' && !msg.key.fromMe) {
            try {
                await socket.sendPresenceUpdate('composing', msg.key.remoteJid);
                setTimeout(async () => {
                    await socket.sendPresenceUpdate('paused', msg.key.remoteJid);
                }, 1000);
            } catch (error) {
                console.error('Failed to set typing indicator:', error);
            }
        }
    });
}

async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
            console.log(`Deleted GitHub session file: ${file.name}`);
        }

        // Update numbers.json on GitHub
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            await updateNumberListOnGitHub(sanitizedNumber);
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json`
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            sha = data.sha;
        } catch (error) {
        }

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
            sha
        });
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) { // 401 indicates user-initiated logout
                console.log(`User ${number} logged out. Deleting session...`);
                
                // Delete session from GitHub
                await deleteSessionFromGitHub(number);
                
                // Delete local session folder
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                // Remove from active sockets
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                // Notify user
                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            'DXLK Mini Bot'
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                // Existing reconnect logic
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`
                });
                sha = data.sha;
            } catch (error) {
            }

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `session/creds_${sanitizedNumber}.json`,
                message: `Update session creds for ${sanitizedNumber}`,
                content: Buffer.from(fileContent).toString('base64'),
                sha
            });
            console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    const groupStatus = groupResult.status === 'success'
                        ? 'Joined successfully'
                        : `Failed to join group: ${groupResult.error}`;
                    await socket.sendMessage(userJid, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '👻 𝐖𝙴𝙻𝙲𝙾𝙼𝙴 𝐓𝙾 DXLK -𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃 👻',
                            `✅ Successfully connected!\n whatsapp channel https://whatsapp.com/channel/0029VbC1S2nEquiQQ5TA1u31\n\n owner=94789227570\n\n owner= 9472 664 5160\n\n owner=94707085822🔢 Number: ${sanitizedNumber}\n`,
                            'DXLK Mini Bot'
                        )
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                        await updateNumberListOnGitHub(sanitizedNumber);
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: '👻 DXLK Mini Bot is running',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    'DXLK Mini Bot'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
});

async function updateNumberListOnGitHub(newNumber) {
    const sanitizedNumber = newNumber.replace(/[^0-9]/g, '');
    const pathOnGitHub = 'session/numbers.json';
    let numbers = [];

    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        numbers = JSON.parse(content);

        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Add ${sanitizedNumber} to numbers list`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64'),
                sha: data.sha
            });
            console.log(`✅ Added ${sanitizedNumber} to GitHub numbers.json`);
        }
    } catch (err) {
        if (err.status === 404) {
            numbers = [sanitizedNumber];
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Create numbers.json with ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64')
            });
            console.log(`📁 Created GitHub numbers.json with ${sanitizedNumber}`);
        } else {
            console.error('❌ Failed to update numbers.json:', err.message);
        }
    }
}

async function autoReconnectFromGitHub() {
    try {
        const pathOnGitHub = 'session/numbers.json';
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const numbers = JSON.parse(content);

        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from GitHub: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromGitHub error:', error.message);
    }
}

autoReconnectFromGitHub();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/ot/refs/heads/main/newsletter_list.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message);
        return [];
    }
}
