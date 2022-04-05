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

// Functions

/**
 * Filter text
 * @param {string} text
 * @returns {string}
 */
const string_filter = text => {
    return htmlspecialchars_decode(text.trim().replace('*', '').replace('_', '')).toString();
};

/**
 * Check present video ID in video IDs
 * @param {string} video_id
 * @param {string} video_ids
 * @returns {boolean}
 */
const video_id_is_present = (video_id, video_ids) => {
    return !!JSON.parse(video_ids).find(e => e === video_id);
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
 * Extract channel data from xml
 * @param {object} xml
 * @returns {{author_name: string, author_url: string}}
 */
const extract_channel_from_xml = xml => {
    return {
        author_name: string_filter(xml.feed.author.name),
        author_url: string_filter(xml.feed.author.uri),
    };
};

/**
 * Extract entry data from xml
 * @param {object} xml
 * @param {number} i
 * @returns {{title: string, video_id}}
 */
const extract_entry_from_xml = (xml, i) => {
    const entry = xml.feed.entry[i];
    return {
        video_id: entry['yt:videoId'],
        title: string_filter(entry.title),
    };
};

// Promises

/**
 * Get xml from url
 * @param {string} url
 * @returns {Promise<unknown>}
 */
const get_xml = url => {
    return new Promise(resolve => {
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
};

/**
 * Save video ID to DB and remove MP3 file
 * @param {object} program Item from Programs modal
 * @param {null|string} video_id Uniq video ID for item
 * @param {null|string} filepath File path
 * @returns {Promise<unknown>}
 */
const save_and_delete = (program, video_id = null, filepath = null) => {
    return new Promise(resolve => {
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
}

/**
 * Save after error
 * @param {object} program
 * @param {string} err
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
 * @param {object} program
 * @returns {Promise<unknown>}
 */
const save_before_download = program => {
    program.state = 1;
    return program.save();
};

/**
 * Get file name
 * @param {string} video_id
 * @returns {Promise<unknown>}
 */
const get_filename = video_id => {
    return new Promise((resolve, reject) => {
        exec('youtube-dl -x --get-filename --no-check-certificate --restrict-filenames "https://www.youtube.com/watch?v=' + video_id + '"', (err, stdout) => {
            if (err) {
                reject(err.toString());
                return;
            }
            const exception = stdout.toString().trim().split('.').reverse()[0];
            resolve(__dirname + '/audio/' + video_id + '.' + exception);
        });
    });
};

/**
 * Get duration audio
 * @param {string} video_id
 * @returns {Promise<unknown>}
 */
const get_duration = video_id => {
    return new Promise((resolve, reject) => {
        exec('youtube-dl -x --get-duration --no-check-certificate --restrict-filenames "https://www.youtube.com/watch?v=' + video_id + '"', (err, stdout) => {
            if (err) {
                reject(err.toString());
                return;
            }
            const out = stdout.toString().trim();
            if (out === '0') {
                reject('duration 0 sec.');
                return;
            }
            const arr = out.split(':').reverse();
            resolve(parseInt(arr[0] || 0) + parseInt(arr[1] || 0) * 60 + parseInt(arr[2] || 0) * 3600);
        });
    });
};

/**
 * Download audio
 * @param {string} video_id
 * @param {string} audio_file_download
 * @returns {Promise<unknown>}
 */
const download_audio = (video_id, audio_file_download) => {
    return new Promise((resolve, reject) => {
        exec('youtube-dl -x --no-progress -f worstaudio --audio-format mp3 --audio-quality 9 --embed-thumbnail --restrict-filenames --no-check-certificate -o ' + audio_file_download + ' "https://www.youtube.com/watch?v=' + video_id + '"', (err, stdout) => {
            if (err) {
                reject(err.toString());
                return;
            }
            resolve({
                stdout: stdout.toString(),
                audio_file: __dirname + '/audio/' + video_id + '.mp3',
            });
        });
    });
};

/**
 * Get file size
 * @param {string} filename
 * @returns {Promise<unknown>}
 */
const get_file_size = filename => {
    return new Promise((resolve, reject) => {
        fs.stat(filename, (err, stats) => {
            if (err) {
                reject(0);
                return;
            }
            const size_mb = parseFloat((stats.size / 1024 / 1024).toFixed(2));
            if (size_mb <= 50) {
                resolve(size_mb);
            } else {
                reject(size_mb);
            }
        });
    });
};

/**
 * Send audio message in Telegram
 * @param {string} audio_file Path to MP3 audio file
 * @param {object} channel
 * @param {object} entry
 * @param {string} tag
 * @param {number} duration
 * @returns {Promise<unknown>}
 */
const send_audio = (audio_file, channel, entry, tag, duration) => {
    return bot.sendAudio(process.env.TELEGRAM_CHANNEL, audio_file, {
        'caption': [
            '*' + entry.title + '*',
            '[Оригинал видео](https://youtu.be/' + entry.video_id + ')',
            '[YouTube канал ' + channel.author_name + '](' + channel.author_url + ')',
            (tag ? '#' + tag + "\n" : '') + process.env.TELEGRAM_CHANNEL,
        ].join("\n\n"),
        'parse_mode': 'markdown',
        'duration': duration,
        'performer': channel.author_name,
        'title': entry.title,
    }, {
        filename: path.basename(audio_file),
        contentType: 'audio/mpeg',
    });
};

/**
 * Main script
 * @param {object} program
 * @returns {Promise<unknown>}
 */
const main = program => {
    return new Promise(resolve => {
        console.log(program.id, 'get xml', program.url, program.tag);
        get_xml(program.url).then(xml => {
            const entry = extract_entry_from_xml(xml, program.index);
            if (!video_id_is_present(entry.video_id, program.video_ids)) {
                save_before_download(program).then(() => {

                    console.log(program.id, 'get filename audio...');
                    get_filename(entry.video_id).then(audio_file_download => {
                        console.log(program.id, 'filename audio', audio_file_download);

                        console.log(program.id, 'get duration audio...');
                        get_duration(entry.video_id).then(duration => {
                            console.log(program.id, 'duration audio', duration, 'sec.');

                            console.log(program.id, 'download audio...');
                            download_audio(entry.video_id, audio_file_download).then(res => {
                                console.log(program.id, res.stdout);
                                const audio_file = res.audio_file;

                                console.log(program.id, 'get file size...');
                                get_file_size(audio_file).then(file_size => {
                                    console.log(program.id, 'file size ' + file_size + ' MB');

                                    console.log(program.id, 'send to tg...');
                                    send_audio(audio_file, extract_channel_from_xml(xml), entry, program.tag, duration).then(res => {
                                        // console.log(program.id, res);
                                        save_and_delete(program, entry.video_id, audio_file).then(() => {
                                            resolve();
                                        });
                                    }).catch(err => {
                                        console.log(program.id, 'Error (send_audio): not send to tg');
                                        console.log(program.id, err);
                                        save_and_delete(program, entry.video_id, audio_file).then(() => {
                                            resolve();
                                        });
                                    });
                                }).catch(file_size => {
                                    console.log(program.id, 'Error (get_file_size): file(' + file_size + ') > 50 MB');
                                    save_and_delete(program, entry.video_id, audio_file).then(() => {
                                        resolve();
                                    });
                                });
                            }).catch(err => {
                                console.log(program.id, 'Error (download_audio): ' + err);
                                save_after_error(program, err.toString()).then(() => {
                                    resolve();
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
        let runs = [];
        for (let program of programs) {
            runs.push(main(program));
        }
        Promise.all(runs).then(() => {
            console.log('finish');
        });
    }
})();
