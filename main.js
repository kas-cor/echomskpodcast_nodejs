require('dotenv').config()

const https = require('https');
const path = require('path');
const fs = require('fs');

const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

const {XMLParser} = require('fast-xml-parser');
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
});

const htmlspecialchars_decode = require('htmlspecialchars_decode');

const database = require('./db');
const Programs = require('./Programs');
const {exec} = require('child_process');

/**
 * Send audio message in Telegram
 * @param {string} audio_file Path to MP3 audio file
 * @param {string} audio_title Filename MP3 audio file
 * @param {string} caption Title for MP3 audio file
 * @param {string} performer
 * @param {string} title
 * @param {number} duration
 * @returns {Promise<unknown>}
 */
const send_audio = (audio_file, audio_title, caption, performer, title, duration) => {
    return new Promise((resolve, reject) => {
        bot.sendAudio(process.env.TELEGRAM_CHANNEL, audio_file, {
            'caption': caption,
            'parse_mode': 'markdown',
            'duration': duration,
            'performer': performer,
            'title': title,
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
 * Save video ID to DB and remove MP3 file
 * @param {Programs<unknown>} program Item from Programs modal
 * @param {null|string} video_id Uniq video ID for item
 * @param {null|string} filepath File path
 * @returns {Promise<unknown>}
 */
const save_and_delete = (program, video_id = null, filepath = null) => {
    console.log(program.id, 'save to db...');
    return new Promise((resolve, reject) => {
        program.index = 0;
        program.state = 0;
        if (video_id) {
            program.video_ids = add_new_video_id(video_id, program.video_ids);
        }
        program.save().then(() => {
            console.log(program.id, 'save ok');
            if (filepath) {
                console.log(program.id, 'delete ' + filepath + '...');
                fs.unlink(filepath, () => {
                    console.log(program.id, 'delete ' + filepath + ' ok');
                    resolve(true);
                });
            } else {
                resolve(true);
            }
        }).catch(() => {
            reject(true);
        });
    });
}

const save_after_error = (program, err) => {
    console.log(program.id, err);
    console.log(program.id, 'save to db...');
    return new Promise((resolve, reject) => {
        program.state = 0;
        if (/ERROR: This live event/im.test(err.toString())) {
            program.index = program.index + 1;
        }
        program.save().then(() => {
            console.log(program.id, 'save ok');
            resolve(true);
        });
    }).catch(() => {
        reject(true);
    });
};

/**
 * Check present video ID in video IDs
 * @param {string} video_id
 * @param {string} video_ids
 * @returns {boolean}
 */
const video_id_is_present = (video_id, video_ids) => {
    let res = false;
    const video_ids_arr = JSON.parse(video_ids);
    for (let i of video_ids_arr) {
        if (video_id === i) {
            res = true;
        }
    }

    return res;
};

/**
 * Add new video ID in video IDs
 * @param {string} video_id
 * @param {string} video_ids
 * @returns {string}
 */
const add_new_video_id = (video_id, video_ids) => {
    let video_ids_arr = JSON.parse(video_ids);
    video_ids_arr.push(video_id);
    if (video_ids_arr.length > 20) {
        video_ids_arr.shift();
    }

    return JSON.stringify(video_ids_arr);
};

/**
 * Filter text
 * @param {string} text
 * @returns {string}
 */
const string_filter = text => {
    return htmlspecialchars_decode(text.trim().replace('*', '').replace('_', '')).toString();
};

(async () => {
    await database.sync({alter: true});

    const args = process.argv.slice(2);

    // Help command
    if (args[0] === 'help') {
        console.log('node main.js add https://...[|https://...]');
        console.log('node main.js list');
        console.log('node main.js remove 1');
        console.log('node main.js tag 1 test');
        console.log('node main.js reset_all_states');
        console.log('node main.js reset_state 1');
        console.log('node main.js reset_ids 1');
    }

    // List all RSS URL from DB
    if (args[0] === 'list') {
        const programs = await Programs.findAll();
        for (let program of programs) {
            console.log(program.id, program.url, program.state, program.tag || '');
        }
    }

    // Add RSS URL to DB
    if (args[0] === 'add' && args[1]) {
        const urls = args[1].split('|');
        for (let url of urls) {
            await Programs.create({
                url: url,
                index: 0,
                state: 0,
                video_ids: '["' + (new Date().getTime()) + '"]',
            });
        }
    }

    // Remove RSS URL from DB
    if (args[0] === 'remove' && args[1]) {
        await Programs.destroy({
            where: {
                id: args[1],
            }
        });
    }

    // Reset all status
    if (args[0] === 'reset_all_states') {
        await Programs.update({
            state: 0,
        }, {
            where: {},
        });
    }

    // Reset state
    if (args[0] === 'reset_state' && args[1]) {
        await Programs.update({
            state: 0,
        }, {
            where: {
                id: args[1],
            },
        });
    }

    // Reset video ID
    if (args[0] === 'reset_ids' && args[1]) {
        await Programs.update({
            video_ids: '["' + (new Date().getTime()) + '"]',
        }, {
            where: {
                id: args[1],
            },
        });
    }

    // Change tag
    if (args[0] === 'tag' && args[1] && args[2]) {
        await Programs.update({
            tag: args[2],
        }, {
            where: {
                id: args[1],
            },
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
            https.get(program.url + '&nocache=' + Math.random(), resp => {
                let data = '';
                resp.on('data', (chunk) => {
                    data += chunk;
                });
                resp.on('end', () => {
                    const xml = parser.parse(data);
                    const video_id = xml.feed.entry[program.index]['yt:videoId'];
                    if (!video_id_is_present(video_id, program.video_ids)) {
                        let duration = 86400;
                        let audio_file_download;
                        const author_name = string_filter(xml.feed.author.name);
                        const author_url = string_filter(xml.feed.author.uri);
                        const title = string_filter(xml.feed.entry[program.index].title);
                        const audio_file = __dirname + '/audio/' + video_id + '.mp3';
                        const audio_title = path.basename(audio_file);
                        console.log(program.id, 'save to db...');
                        program.state = 1;
                        program.save().then(() => {
                            console.log(program.id, 'save ok');
                            console.log(program.id, 'get filename audio...');
                            exec('youtube-dl -x --get-filename --no-check-certificate --restrict-filenames "https://www.youtube.com/watch?v=' + video_id + '"', (err, stdout, stderr) => {
                                if (err) {
                                    save_after_error(program, err.toString()).then(() => {
                                        console.log(program.id, 'save ok');
                                    });
                                    return;
                                }
                                const audio_format = stdout.toString().trim().split('.').reverse()[0];
                                audio_file_download = __dirname + '/audio/' + video_id + '.' + audio_format;
                                console.log(program.id, 'filename audio', video_id + '.' + audio_format);
                                console.log(program.id, 'get duration audio...');
                                exec('youtube-dl -x --get-duration --no-check-certificate --restrict-filenames "https://www.youtube.com/watch?v=' + video_id + '"', (err, stdout, stderr) => {
                                    if (err) {
                                        save_after_error(program, err.toString()).then(() => {
                                            console.log(program.id, 'save ok');
                                        });
                                        return;
                                    }
                                    const arr = stdout.toString().trim().split(':').reverse();
                                    duration = parseInt(arr[0] || 0) + parseInt(arr[1] || 0) * 60 + parseInt(arr[2] || 0) * 3600;
                                    console.log(program.id, 'duration audio', duration, 'sec.');
                                    console.log(program.id, 'download audio...');
                                    exec('youtube-dl -x --no-progress -f worstaudio --audio-format mp3 --audio-quality 9 --embed-thumbnail --restrict-filenames --no-check-certificate -o ' + audio_file_download + ' "https://www.youtube.com/watch?v=' + video_id + '"', (err, stdout, stderr) => {
                                        if (err) {
                                            save_after_error(program, err.toString()).then(() => {
                                                console.log(program.id, 'save ok');
                                            });
                                            return;
                                        }
                                        console.log(program.id, 'download ok');
                                        console.log(program.id, stdout.toString());
                                        const caption = [
                                            '*' + title + '*',
                                            '[Оригинал видео](https://youtu.be/' + video_id + ')',
                                            '[YouTube канал ' + author_name + '](' + author_url + ')',
                                            (program.tag ? '#' + program.tag + "\n" : '') + process.env.TELEGRAM_CHANNEL,
                                        ].join("\n\n");
                                        const stats = fs.statSync(audio_file);
                                        const fileSizeInBytes = stats.size;
                                        if (fileSizeInBytes / 1024 / 1024 <= 50) {
                                            console.log(program.id, 'send to tg...');
                                            send_audio(audio_file, audio_title, caption, author_name, title, duration).then(res => {
                                                // console.log(program.id, res);
                                                save_and_delete(program, video_id, audio_file).then(() => {
                                                    console.log(program.id, 'save ok');
                                                });
                                            }).catch(err => {
                                                console.log(program.id, 'err: not send to tg!');
                                                console.log(program.id, err);
                                                save_and_delete(program, video_id, audio_file).then(() => {
                                                    console.log(program.id, 'save ok');
                                                });
                                            });
                                        } else {
                                            console.log(program.id, 'err: file > 50mb!');
                                            save_and_delete(program, video_id, audio_file).then(() => {
                                                console.log(program.id, 'save ok');
                                            });
                                        }
                                    });
                                });
                            });
                        });
                    } else {
                        console.log(program.id, 'info: old');
                        save_and_delete(program).then(() => {
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
