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

/**
 * Send audio message in Telegram
 * @param {string} audio_file Path to MP3 audio file
 * @param {string} audio_title Filename MP3 audio file
 * @param {string} caption Title for MP3 audio file
 * @param {number} duration Duration MP3 audio file
 * @returns {Promise<unknown>}
 */
const send_audio = (audio_file, audio_title, caption, duration) => {
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

/**
 * Save hash to DB and remove MP3 file
 * @param {Programs<unknown>} program Item from Programs modal
 * @param {string} hash Uniq hash for item
 * @param {string} path_filename Path to filename for remove
 * @returns {Promise<unknown>}
 */
const save_and_delete = (program, hash, path_filename) => {
    return new Promise((resolve, reject) => {
        program.hash = hash;
        program.save().then(() => {
            console.log(program.id, 'save ok');
            console.log(program.id, 'delete mp3...');
            fs.unlink(path_filename, () => {
                console.log(program.id, 'delete ok');
                resolve(true);
            });
        }).catch(() => {
            reject(true);
        });
    });
}

(async () => {
    await database.sync();

    const args = process.argv.slice(2);

    // Help command
    if (args[0] === 'help') {
        console.log('node main.js add https://...');
        console.log('node main.js list');
        console.log('node main.js remove 1');
    }

    // List all RSS URL from DB
    if (args[0] === 'list') {
        const programs = await Programs.findAll();
        for (let program of programs) {
            console.log(program.id, program.url);
        }
    }

    // Add RSS URL to DB
    if (args[0] === 'add') {
        const urls = args[1].split('|');
        for (let url of urls) {
            await Programs.create({
                url: url,
                hash: md5(new Date().getTime()),
            });
        }
    }

    // Remove RSS URL from DB
    if (args[0] === 'remove') {
        await Programs.destroy({
            where: {
                id: args[1],
            }
        });
    }

    // Run update
    if (!args[0]) {
        const programs = await Programs.findAll();
        for (let program of programs) {
            console.log(program.id, 'get xml ' + program.url);
            https.get(program.url + '?nocache=' + md5(new Date().getTime()), resp => {
                let data = '';
                resp.on('data', (chunk) => {
                    data += chunk;
                });
                resp.on('end', () => {
                    const xml = parser.parse(data);
                    const pubDate = xml.rss.channel.item[0].pubDate;
                    const hash = md5(pubDate);
                    if (program.hash !== hash) {
                        const audio_url = xml.rss.channel.item[0].guid;
                        const audio_title = path.basename(xml.rss.channel.item[0].guid);
                        const audio_file = __dirname + '/audio/';
                        console.log(program.id, 'download mp3 ' + audio_url);
                        download(audio_url, audio_file).then(() => {
                            console.log(program.id, 'download ok');
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
                                setTimeout(() => {
                                    console.log(program.id, 'send to tg...');
                                    send_audio(audio_file + audio_title, audio_title, caption, duration).then(tlgm => {
                                        if (tlgm) {
                                            console.log(program.id, 'save to db...');
                                            save_and_delete(program, hash, audio_file + audio_title).then(() => {
                                                console.log(program.id, 'save ok');
                                            });
                                        } else {
                                            console.log(program.id, 'err: not send to tg!');
                                        }
                                    });
                                }, 1000);
                            } else {
                                console.log(program.id, 'err: file > 50mb!');
                                console.log(program.id, 'save to db...');
                                save_and_delete(program, hash, audio_file + audio_title).then(() => {
                                    console.log(program.id, 'save ok');
                                });
                            }
                        });
                    } else {
                        console.log(program.id, 'info: old');
                    }
                });
            }).on('error', err => {
                console.log(program.id, 'err: ' + err);
            });
        }
    }
})();
