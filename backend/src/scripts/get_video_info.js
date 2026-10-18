import fs from 'fs';

const html = fs.readFileSync('C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603/.system_generated/steps/18973/content.md', 'utf8');

const titleMatch = html.match(/<title>(.*?)<\/title>/);
console.log('Title:', titleMatch ? titleMatch[1] : 'No title');

const metaDesc = html.match(/<meta name="description" content="(.*?)">/);
console.log('Meta Desc:', metaDesc ? metaDesc[1] : 'No meta desc');

const channelMatch = html.match(/"ownerChannelName":"(.*?)"/);
console.log('Channel:', channelMatch ? channelMatch[1] : 'No channel');

const authorMatch = html.match(/"author":"(.*?)"/);
console.log('Author:', authorMatch ? authorMatch[1] : 'No author');
