require('dotenv').config()

const md5 = require('md5');
const download = require('download');
const moment = require('moment');
const https = require('https');
const path = require('path');
const fs = require('fs');

const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

const {XMLParser} = require('fast-xml-parser');
const parser = new XMLParser();

const database = require('./db');
const Programs = require('./Programs');

const send_audio = async (audio_file, audio_title, caption, duration) => {
    return new Promise((resolve, reject) => {
        bot.sendAudio(process.env.TELEGRAM_CHANNEL, audio_file, {
            'caption': caption,
            'parse_mode': 'markdown',
            'duration': duration,
        }, {
            filename: audio_title,
            contentType: 'audio/mpeg',
        }).then(() => {
            resolve(true);
        }).catch(() => {
            reject(false);
        });
    });
}

(async () => {
    try {
        await database.sync();

        const args = process.argv.slice(2);

        if (args[0] === 'help') {
            console.log('node main.js add https://...');
            console.log('node main.js list');
            console.log('node main.js remove 1');
        }

        if (args[0] === 'list') {
            const programs = await Programs.findAll();
            for (let program of programs) {
                console.log(program.id, program.url);
            }
        }

        if (args[0] === 'add') {
            const urls = args[1].split('|');
            for (let url of urls) {
                await Programs.create({
                    url: url,
                    hash: md5(new Date().getTime()),
                });
            }
        }

        if (args[0] === 'remove') {
            await Programs.destroy({
                where: {
                    id: args[1],
                }
            });
        }

        if (!args[0]) {
            const programs = await Programs.findAll();
            for (let program of programs) {
                https.get(program.url + '?nocache=' + md5(new Date().getTime()), (resp) => {
                    let data = '';
                    resp.on('data', (chunk) => {
                        data += chunk;
                    });
                    resp.on('end', () => {
                        const xml = parser.parse(data);
                        const pubDate = xml.rss.channel.item[0].pubDate;
                        const hash = md5(pubDate);
                        if (program.hash !== hash) {
                            console.log('new - ' + pubDate + ' - ' + program.url);
                            const audio_url = xml.rss.channel.item[0].guid;
                            const audio_title = path.basename(xml.rss.channel.item[0].guid);
                            const audio_file = __dirname + '/audio/';
                            download(audio_url, audio_file).then(async () => {
                                const caption = [
                                    '*' + (xml.rss.channel.item[0].title).trim() + '*',
                                    '_Эфир от ' + moment(pubDate).format('DD.MM.YYYY (HH:mm)') + '_',
                                    '[Текст расшифровки передачи](' + xml.rss.channel.item[0].link + ')',
                                ].join("\n\n");
                                const duration_arr = (xml.rss.channel.item[0]['itunes:duration']).split(':');
                                const duration = parseInt(duration_arr[0]) * 3600 + parseInt(duration_arr[1]);
                                const stats = fs.statSync(audio_file + audio_title);
                                const fileSizeInBytes = stats.size;
                                if (fileSizeInBytes / 1024 / 1024 <= 50) {
                                    const tlgm = await send_audio(audio_file + audio_title, audio_title, caption, duration);
                                    if (tlgm) {
                                        program.hash = hash;
                                        await program.save();
                                    }
                                } else {
                                    console.log('file > 50MB');
                                }
                                fs.unlinkSync(audio_file + audio_title);
                            }).catch(err => {
                                console.log(err);
                            });
                        }
                    });
                }).on('error', (err) => {
                    console.log(err.message);
                });
            }
        }
    } catch (error) {
        console.log(error);
    }
})();
