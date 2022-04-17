require('dotenv').config()

const https = require('https');
const path = require('path');
const fs = require('fs');

const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

const {XMLParser} = require('fast-xml-parser');
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
});

const database = require('./db');
const Programs = require('./Programs');

const {exec} = require('child_process');
const exec_regular_params = 'youtube-dl -x --no-progress --no-check-certificate --restrict-filenames';
const exec_get_filename = exec_regular_params + ' --get-filename "https://www.youtube.com/watch?v={video_id}"';
const exec_get_duration = exec_regular_params + ' --get-duration "https://www.youtube.com/watch?v={video_id}"';
const exec_get_title = exec_regular_params + ' --get-title "https://www.youtube.com/watch?v={video_id}"';
const exec_download = exec_regular_params + ' -f worstaudio --audio-format mp3 --audio-quality 9 --embed-thumbnail -o {output_file} "https://www.youtube.com/watch?v={video_id}"';

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
        text = text.replaceAll(search, replace[search]);
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
        resp.on('data', (chunk) => {
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
const save_and_delete = (program, video_id = null, filepath = null) => new Promise(resolve => {
    program.index = 0;
    program.state = 0;
    if (video_id) {
        program.video_ids = add_new_video_id(video_id, program.video_ids);
    }
    program.save().then(() => {
        if (filepath) {
            fs.unlink(filepath, () => {
                console.log(program.id, 'delete ' + filepath);
                resolve();
            });
        } else {
            resolve();
        }
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
    if (/ERROR: This live event/im.test(err)) {
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
 * @param {string} command Execute command
 * @returns {Promise<unknown>}
 */
const youtube_dl = command => new Promise((resolve, reject) => {
    exec(command, (err, stdout) => {
        if (err) {
            reject(err.toString().trim());
        }
        resolve(stdout.toString().trim());
    });
});

/**
 * Get file name
 * @param {string} video_id Uniq video ID
 * @returns {Promise<unknown>}
 */
const get_filename = video_id => youtube_dl(exec_get_filename.replace('{video_id}', video_id)).then(res => {
    return __dirname + '/audio/' + video_id + '.' + res.split('.').reverse()[0];
});

/**
 * Get duration audio
 * @param {string} video_id Uniq video ID
 * @returns {Promise<unknown>}
 */
const get_duration = video_id => youtube_dl(exec_get_duration.replace('{video_id}', video_id)).then(res => {
    if (res === '0') {
        return {
            'full': '',
            'sec': 0,
        };
    }
    const part = res.split(':').reverse();
    return {
        'full': res,
        'sec': parseInt(part[0] || 0) + parseInt(part[1] || 0) * 60 + parseInt(part[2] || 0) * 3600,
    }
});

/**
 * Get title audio
 * @param {string} video_id Uniq video ID
 * @returns {Promise<unknown>}
 */
const get_title = video_id => youtube_dl(exec_get_title.replace('{video_id}', video_id));

/**
 * Download audio
 * @param {string} video_id Uniq video ID
 * @param {string} audio_file_download Output filepath
 * @returns {Promise<unknown>}
 */
const download_audio = (video_id, audio_file_download) => youtube_dl(exec_download.replace('{output_file}', audio_file_download).replace('{video_id}', video_id)).then(res => {
    return {
        stdout: res,
        audio_file: __dirname + '/audio/' + video_id + '.mp3',
    };
});

/**
 * Get file size
 * @param {string} filename Filename audio
 * @returns {Promise<unknown>}
 */
const get_file_size = filename => new Promise((resolve, reject) => {
    fs.stat(filename, (err, stats) => {
        if (err) {
            reject(0);
        }
        const size_mb = parseFloat((stats.size / 1024 / 1024).toFixed(2));
        if (size_mb <= 50) {
            resolve(size_mb);
        } else {
            reject(size_mb);
        }
    });
});

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
        (data.tag ? '#' + data.tag + "\n" : '') + process.env.TELEGRAM_CHANNEL,
    ].join("\n\n"),
    'parse_mode': 'markdown',
    'duration': data.duration,
    'performer': data.channel.author_name,
    'title': data.title,
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
        const video_id = xml.feed.entry[program.index]['yt:videoId'];
        if (!video_id_is_present(video_id, program.video_ids)) {
            save_before_download(program).then(() => {

                console.log(program.id, 'get filename audio...');
                get_filename(video_id).then(audio_file_download => {
                    console.log(program.id, 'filename audio', audio_file_download);

                    console.log(program.id, 'get duration audio...');
                    get_duration(video_id).then(duration => {
                        console.log(program.id, 'duration audio', duration.full, '-', duration.sec, 'sec.');

                        console.log(program.id, 'get title audio...');
                        get_title(video_id).then(title => {
                            console.log(program.id, 'title audio', title);

                            console.log(program.id, 'download audio...');
                            download_audio(video_id, audio_file_download).then(res => {
                                console.log(program.id, res.stdout);
                                const audio_file = res.audio_file;

                                console.log(program.id, 'get file size...');
                                get_file_size(audio_file).then(file_size => {
                                    console.log(program.id, 'file size ' + file_size + ' MB');

                                    console.log(program.id, 'send to tg...');
                                    send_audio({
                                        audio_file: audio_file,
                                        video_id: video_id,
                                        tag: program.tag,
                                        duration: duration.sec,
                                        title: string_filter(title),
                                        channel: extract_channel_from_xml(xml),
                                    }).then(res => {
                                        // console.log(program.id, res);
                                        save_and_delete(program, video_id, audio_file).then(() => {
                                            resolve();
                                        });
                                    }).catch(err => {
                                        console.log(program.id, 'Error (send_audio): not send to tg');
                                        console.log(program.id, err);
                                        save_and_delete(program, video_id, audio_file).then(() => {
                                            resolve();
                                        });
                                    });
                                }).catch(file_size => {
                                    console.log(program.id, 'Error (get_file_size): file(' + file_size + ') > 50 MB');
                                    save_and_delete(program, video_id, audio_file).then(() => {
                                        resolve();
                                    });
                                });
                            }).catch(err => {
                                console.log(program.id, 'Error (download_audio): ' + err);
                                save_after_error(program, err.toString()).then(() => {
                                    resolve();
                                });
                            });
                        });
                    }).catch(err => {
                        console.log(program.id, 'Error (get_duration): ' + err);
                        save_after_error(program, err.toString()).then(() => {
                            resolve();
                        });
                    });
                }).catch(err => {
                    console.log(program.id, 'Error (get_filename): ' + err);
                    save_after_error(program, err.toString()).then(() => {
                        resolve();
                    });
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
        const programs = await Programs.findAll({
            where: {
                state: 0,
            },
        });
        let runs = [];
        for (let program of programs) {
            runs.push(main(program));
        }
        Promise.all(runs).then(() => {
            console.log('finish');
        });
    }
})();
