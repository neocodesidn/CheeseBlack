'use strict';
const BOT_NAME = String(process.env.BOT_NAME || 'Community Exploit Bot').trim().slice(0, 80) || 'Community Exploit Bot';
const BOT_DESCRIPTION = String(process.env.BOT_DESCRIPTION || 'Exploit, Game Development & Coding Community').trim().slice(0, 160);
module.exports = { BOT_NAME, BOT_DESCRIPTION };
