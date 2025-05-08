require('dotenv').config();

const https = require('node:https');
const path = require('node:path');
const fs = require('node:fs');
const sleep = require('sleep');
const sharp = require('sharp');

const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    baseApiUrl: process.env.TELEGRAM_ENTRYPOINT || 'https://api.telegram.org',
});

const {XMLParser} = require('fast-xml-parser');
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
});

const database = require('./db');
const Programs = require('./Programs');

const {spawn} = require('child_process');
const exec_yt_dlp = './yt-dlp';
const exec_get_info = '-j ytsearch:"{video_id}"';
const exec_download = '-f ba --audio-format mp3 --write-thumbnail --embed-thumbnail -o {output_audio_file} ytsearch:"{video_id}"';

// Functions

/**
 * Filter text
 * @param {string} text
 * @returns {string}
 */
const string_filter = text => {
    const replace = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#039;': '\'',
        '&lsqb;': '[',
        '&rsqb;': ']',
        '&Hat;': '^',
        '&sol;': '/',
        '&lpar;': '(',
        '&rpar;': ')',
        '&plus;': '+',
        '&bsol;': '\\',
        '&nbsp;': ' ',
        '&copy;': '©',
        '*': '',
        '_': ' ',
    };
    for (const search in replace) {
        if (replace.hasOwnProperty(search)) {
            text = text.replaceAll(search, replace[search]);
        }
    }

    return text.trim();
};

/**
 * Check present video ID in video IDs
 * @param {string} video_id
 * @param {string} video_ids
 * @returns {boolean}
 */
const video_id_is_present = (video_id, video_ids) => !!JSON.parse(video_ids).find(e => e === video_id);

/**
 * Add new video ID in video IDs
 * @param {string} video_id Video ID
 * @param {string} video_ids Video IDs
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
 * Extract channel data from xml
 * @param {object} xml XML object
 * @returns {{author_name: string, author_url: string}}
 */
const extract_channel_from_xml = xml => {
    return {
        author_name: string_filter(xml.feed.author.name),
        author_url: xml.feed.author.uri,
    };
};

// Promises

/**
 * Get xml from url
 * @param {string} url Url RSS channel
 * @returns {Promise<unknown>}
 */
const get_xml = url => new Promise(resolve => {
    https.get(url + '&nocache=' + Math.random(), resp => {
        let data = '';
        resp.on('data', chunk => {
            data += chunk;
        });
        resp.on('end', () => {
            resolve(parser.parse(data));
        });
    });
});

/**
 * Save video ID to DB and remove MP3 file
 * @param {object} program Item from Programs modal
 * @param {null|string} video_id Uniq video ID for item
 * @param {null|string} filepath File path to audio mp3
 * @returns {Promise<unknown>}
 */
const save_and_delete = (program, video_id = null) => new Promise(resolve => {
    program.index = 0;
    program.state = 0;
    if (video_id) {
        program.video_ids = add_new_video_id(video_id, program.video_ids);
    }
    program.save().then(() => {
        if (video_id) {
            let filepath = __dirname + '/audio/' + video_id + '.mp3';
            try {
                fs.unlinkSync(filepath);
                console.log(program.id, 'delete ' + filepath);
            } catch (e) {
            }
            try {
                fs.unlinkSync(filepath + '.webp');
                console.log(program.id, 'delete ' + filepath + '.webp');
            } catch (e) {
            }
            try {
                fs.unlinkSync(filepath + '.jpg');
                console.log(program.id, 'delete ' + filepath + '.jpg');
            } catch (e) {
            }
        }
        resolve();
    });
});

/**
 * Save after error
 * @param {object} program Item from Programs modal
 * @param {string} err Error description
 * @returns {Promise<unknown>}
 */
const save_after_error = (program, err) => {
    program.state = 0;
    if (/This live event/im.test(err)) {
        program.index = program.index + 1;
    }
    return program.save();
};

/**
 * Save before download
 * @param {object} program Item from Programs modal
 * @returns {Promise<unknown>}
 */
const save_before_download = program => {
    program.state = 1;
    return program.save();
};

/**
 * Execute youtube_dl command
 * @param {string} params Execute command
 * @returns {Promise<unknown>}
 */
const youtube_dl = params => new Promise((resolve, reject) => {
    sleep.sleep(5);
    const child = spawn(exec_yt_dlp, params.split(' '));

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', data => {
        output += data.toString();
    });

    child.stderr.on('data', data => {
        errorOutput += data.toString();
    });

    child.on('close', code => {
        if (code === 0) {
            resolve(output.trim());
        } else {
            reject(errorOutput.trim());
        }
    });
});

/**
 * Get info
 * @param {string} video_id Uniq video ID
 * @returns {Promise<unknown>}
 */
const get_info = video_id => youtube_dl(exec_get_info.replace('{video_id}', video_id)).then(res => JSON.parse(res));

/**
 * Download audio
 * @param {string} video_id Uniq video ID
 * @returns {Promise<unknown>}
 */
const download_audio = video_id => {
    const filepath = __dirname + '/audio/' + video_id + '.mp3';
    return youtube_dl(exec_download.replace('{output_audio_file}', filepath).replace('{video_id}', video_id)).then(res => {
        (async () => {
            await sharp(filepath + '.webp').resize({width: 320, height: 320, fit: 'inside'}).jpeg().toFile(filepath + '.jpg');
        })();

        return {
            stdout: res,
            audio_file: filepath,
            thumbnail_file: filepath + '.jpg',
        };
    });
};

/**
 * Send audio message in Telegram
 * @param {object} data Object whit data
 * @returns {Promise<unknown>}
 */
const send_audio = data => bot.sendAudio(process.env.TELEGRAM_CHANNEL, data.audio_file, {
    'caption': [
        '*' + data.title + '*',
        '📅 _Опубликовано: ' + new Date().toLocaleDateString('ru-RU') + '_',
        '[Оригинал видео](https://youtu.be/' + data.video_id + ')' + "\n" + '[YouTube канал ' + data.channel.author_name + '](' + data.channel.author_url + ')',
        [
            data.tag ? '#' + data.tag : null,
            process.env.TELEGRAM_CHANNEL_URL ? '[' + process.env.TELEGRAM_CHANNEL + '](' + process.env.TELEGRAM_CHANNEL_URL + ')' : process.env.TELEGRAM_CHANNEL,
            process.env.TELEGRAM_CHANNEL_BOOST_URL ? '[Буст каналу](' + process.env.TELEGRAM_CHANNEL_BOOST_URL + ')' : null,
        ].filter(Boolean).join("\n"),
    ].join("\n\n"),
    'parse_mode': 'markdown',
    'duration': data.duration,
    'performer': data.channel.author_name,
    'title': data.title,
    'thumb': data.thumb,
}, {
    filename: path.basename(data.audio_file),
    contentType: 'audio/mpeg',
});

/**
 * Main script
 * @param {object} program Item from Programs modal
 * @returns {Promise<unknown>}
 */
const main = program => new Promise(resolve => {
    console.log(program.id, 'get xml', program.url, program.tag);
    get_xml(program.url).then(xml => {
        const video_id = !!(xml.feed.entry).length ? xml.feed.entry[program.index]['yt:videoId'] : xml.feed.entry['yt:videoId'];
        if (!video_id_is_present(video_id, program.video_ids)) {
            console.log(program.id, 'get info...');
            get_info(video_id).then(info => {
                let make_break = false;
                if (info.is_live === 'True') {
                    console.log(program.id, 'is live - pass');
                    make_break = true;
                }
                if (info.original_url.includes('shorts')) {
                    console.log(program.id, 'is shorts - pass');
                    make_break = true;
                }
                if (make_break) {
                    save_and_delete(program).then(() => {
                        resolve();
                    });
                    return;
                }
                save_before_download(program).then(() => {
                    console.log(program.id, 'duration', info.duration, 'sec.', 'title', info.title);
                    console.log(program.id, 'download audio & thumbnail(resize)...');
                    download_audio(video_id).then(res => {
                        const audio_file = res.audio_file;
                        const thumbnail_file = res.thumbnail_file;
                        console.log(program.id, res.stdout);
                        console.log(program.id, 'filenames', audio_file, thumbnail_file);
                        console.log(program.id, 'send to tg...');
                        send_audio({
                            audio_file: audio_file,
                            video_id: video_id,
                            tag: program.tag,
                            duration: info.duration,
                            title: string_filter(info.title),
                            channel: extract_channel_from_xml(xml),
                            thumb: thumbnail_file,
                        }).then(res => {
                            console.log(program.id, 'message_id', res.message_id);
                            save_and_delete(program, video_id).then(() => {
                                resolve();
                            });
                        }).catch(err => {
                            console.log(program.id, 'Error (send_audio): not send to tg -', err);
                            save_and_delete(program, video_id).then(() => {
                                resolve();
                            });
                        });
                    }).catch(err => {
                        console.log(program.id, 'Error (download_audio):', err);
                        save_after_error(program, err.toString()).then(() => {
                            resolve();
                        });
                    });
                });
            }).catch(err => {
                console.log(program.id, 'get info error:', err);
                save_after_error(program, err.toString()).then(() => {
                    resolve();
                });
            });
        } else {
            console.log(program.id, 'pass');
            save_and_delete(program).then(() => {
                resolve();
            });
        }
    });
});

(async () => {
    await database.sync({alter: true});

    const args = process.argv.slice(2);

    // Help command
    if (args[0] === 'help') {
        console.log('node main.js add {channel_id}[|{channel_id}]');
        console.log('node main.js list');
        console.log('node main.js remove {id}');
        console.log('node main.js tag {id} test');
        console.log('node main.js reset_all_states');
        console.log('node main.js reset_state {id}');
        console.log('node main.js reset_ids {id}');
    }

    // List all channels from DB
    if (args[0] === 'list') {
        const programs = await Programs.findAll();
        for (let program of programs) {
            console.log(program.id, program.url, program.state, program.tag || '');
        }
    }

    // Add channel ID to DB
    if (args[0] === 'add' && args[1]) {
        const channel_ids = args[1].split('|');
        for (let channel_id of channel_ids) {
            await Programs.create({
                url: 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channel_id,
                index: 0,
                state: 0,
                video_ids: '["' + new Date().getTime() + '"]',
            });
        }
    }

    // Remove channel from DB
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

    // Reset video IDs in channel
    if (args[0] === 'reset_ids' && args[1]) {
        await Programs.update({
            video_ids: '["' + new Date().getTime() + '"]',
        }, {
            where: {
                id: args[1],
            },
        });
    }

    // Change tag in channel
    if (args[0] === 'tag' && args[1] && args[2]) {
        await Programs.update({
            tag: args[2],
        }, {
            where: {
                id: args[1],
            },
        });
    }

    // Run check and download audio from channels
    if (!args[0]) {
        const programs = await Programs.findAll();
        let runs = [];
        for (let program of programs) {
            if (program.state === 1 && new Date() - new Date(program.updatedAt) > 2 * 60 * 60 * 1000) {
                program.state = 0;
                await program.save();
            } else if (program.state === 0) {
                runs.push(main(program));
            }
        }
        Promise.all(runs).then(() => {
            console.log('finish');
        });
    }
})();
