require('dotenv').config()

const md5 = require('md5');
const https = require('https');
const path = require('path');
const fs = require('fs');

const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

const {XMLParser} = require('fast-xml-parser');
const parser = new XMLParser();

const database = require('./db');
const Programs = require('./Programs');
const {exec} = require('child_process');

/**
 * Send audio message in Telegram
 * @param {string} audio_file Path to MP3 audio file
 * @param {string} audio_title Filename MP3 audio file
 * @param {string} caption Title for MP3 audio file
 * @returns {Promise<unknown>}
 */
const send_audio = (audio_file, audio_title, caption) => {
    return new Promise((resolve, reject) => {
        bot.sendAudio(process.env.TELEGRAM_CHANNEL, audio_file, {
            'caption': caption,
            'parse_mode': 'markdown',
        }, {
            filename: audio_title,
            contentType: 'audio/mpeg',
        }).then(res => {
            resolve(res);
        }).catch(err => {
            reject(err);
        });
    });
}

/**
 * Save hash to DB and remove MP3 file
 * @param {Programs<unknown>} program Item from Programs modal
 * @param {string} hash Uniq hash for item
 * @param {null|string} path_filename Path to filename for remove
 * @returns {Promise<unknown>}
 */
const save_and_delete = (program, hash, path_filename = null) => {
    return new Promise((resolve, reject) => {
        program.index = 0;
        program.state = 0;
        program.hash = hash;
        program.save().then(() => {
            console.log(program.id, 'save ok');
            if (path_filename) {
                console.log(program.id, 'delete mp3...');
                fs.unlink(path_filename, () => {
                    console.log(program.id, 'delete ok');
                    resolve(true);
                });
            }
            resolve(true);
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
                index: 0,
                state: 0,
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
        const programs = await Programs.findAll({
            where: {
                state: 0,
            },
        });
        for (let program of programs) {
            console.log(program.id, 'get xml ' + program.url);
            https.get(program.url + '&nocache=' + md5(new Date().getTime()), resp => {
                let data = '';
                resp.on('data', (chunk) => {
                    data += chunk;
                });
                resp.on('end', () => {
                    const xml = parser.parse(data);
                    const hash = md5(xml.feed.entry[program.index].id);
                    if (program.hash !== hash) {
                        const video_id = xml.feed.entry[program.index]['yt:videoId'];
                        const title = xml.feed.entry[program.index].title;
                        const audio_file = __dirname + '/audio/' + video_id + '.mp3';
                        const audio_title = path.basename(audio_file);
                        console.log(program.id, 'save to db...');
                        program.state = 1;
                        program.save().then(() => {
                            console.log(program.id, 'save ok');
                            console.log(program.id, 'download audio...');
                            exec('youtube-dl -x --no-progress --max-filesize 50M -f worstaudio --audio-format mp3 --restrict-filenames --no-check-certificate -o ' + audio_file + ' "https://www.youtube.com/watch?v=' + video_id + '"', (err, stdout, stderr) => {
                                if (err) {
                                    console.log(program.id, err.toString());
                                    console.log(program.id, 'save to db...');
                                    program.state = 0;
                                    if (/ERROR: This live event/im.test(err.toString())) {
                                        program.index = program.index + 1;
                                    }
                                    program.save().then(() => {
                                        console.log(program.id, 'save ok');
                                    });
                                    return;
                                }
                                console.log(program.id, stdout.toString());
                                console.log(program.id, 'download ok');
                                const caption = [
                                    '*' + (title).trim() + '*',
                                    '[Ссылка на оригинал видео](https://youtu.be/' + video_id + ')',
                                ].join("\n\n");
                                const stats = fs.statSync(audio_file);
                                const fileSizeInBytes = stats.size;
                                if (fileSizeInBytes / 1024 / 1024 <= 50) {
                                    setTimeout(() => {
                                        console.log(program.id, 'send to tg...');
                                        send_audio(audio_file, audio_title, caption, audio_thumb).then(res => {
                                            // console.log(program.id, res);
                                            console.log(program.id, 'save to db...');
                                            save_and_delete(program, hash, audio_file).then(() => {
                                                console.log(program.id, 'save ok');
                                            });
                                        }).catch(err => {
                                            console.log(program.id, 'err: not send to tg!');
                                            console.log(program.id, err);
                                        });
                                    }, 1000);
                                } else {
                                    console.log(program.id, 'err: file > 50mb!');
                                    console.log(program.id, 'save to db...');
                                    save_and_delete(program, hash, audio_file).then(() => {
                                        console.log(program.id, 'save ok');
                                    });
                                }
                            });
                        });
                    } else {
                        console.log(program.id, 'info: old');
                        console.log(program.id, 'save to db...');
                        save_and_delete(program, hash).then(() => {
                            console.log(program.id, 'save ok');
                        });
                    }
                });
            }).on('error', err => {
                console.log(program.id, 'err: ' + err);
            });
        }
    }
})();
